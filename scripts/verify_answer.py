#!/usr/bin/env python3
"""
verify_answer.py

Independent, deterministic re-derivation of a solve-first SKELETON's claimed
answer, using SymPy instead of an LLM. This is the "root cause 1" fix from
the pipeline review: hardQuestionMandate.service.js checks structure (step
count, concept-cluster count) and difficultySelfAudit.service.js checks an
LLM's opinion of how hard something *looks* — neither ever recomputes the
actual number, which is how wrong answer keys were shipping while both
gates passed.

Where this sits in the pipeline (see skeletonCasVerification.service.js and
its call site in aiQuestion.service.js, right after parseSolveFirstSkeletons
and BEFORE the difficulty self-audit LLM call):

    Gemini skeleton response
      -> parseSolveFirstSkeletons()
      -> [[ THIS: verify_answer.py re-derives finalAnswer from `givens` ]]
      -> difficultySelfAudit (unchanged, qualitative LLM rubric)
      -> hardQuestionMandate (unchanged, structural gate)
      -> buildMcqFromSkeleton (unchanged)

It only checks skeletons that declare a recognized `archetype` + structured
`givens` (see the prompt-contract block added to
buildSolveFirstSkeletonPrompt in questionSolveFirst.service.js). Anything
else comes back `verified: null` — "not machine-checkable", which is a
no-op, NOT a rejection. Only `verified: false` (a provable numeric
mismatch) causes a hard reject.

Usage (see skeletonCasVerification.service.js):
    echo '{"archetype": "definite_integral", "givens": {...}, "claimed_answer": 0.5}' \
      | python scripts/verify_answer.py

Output (stdout, one line of JSON):
    {"verified": true|false|null, "computed_answer": <num|null>,
     "claimed_answer": <num|null>, "delta": <num|null>, "note": "..."}
"""

from __future__ import annotations

import sys
import json
import traceback


def _num(x, sp):
    """Coerce a sympy result to a python float, rejecting non-real results."""
    val = complex(sp.N(x))
    if abs(val.imag) > 1e-6 * max(1.0, abs(val.real)):
        raise ValueError(f"non-real result: {val}")
    return float(val.real)


def _tolerance(computed: float) -> float:
    """
    Generous on purpose: the skeleton's `claimed_answer` is usually a
    generator-rounded decimal (e.g. "0.0167" for an exact 1/60), not the
    exact symbolic value. A tight tolerance would false-reject correct
    answers on rounding alone. Real errors (wrong bound, wrong sign, wrong
    constant) are almost always >> this margin.
    """
    return max(1e-4, 0.02 * abs(computed))


def _build_archetypes(sp):
    x = sp.symbols("x")

    def area_between_curves(givens):
        """
        givens = {
          "f_expr": "x**2", "g_expr": "x",
          "lower": "0", "upper": "1",       # ignored if auto_bounds
          "auto_bounds": true|false          # solve f=g for the two bounds
        }
        """
        f = sp.sympify(givens["f_expr"])
        g = sp.sympify(givens["g_expr"])

        if givens.get("auto_bounds"):
            pts = sp.solve(sp.Eq(f, g), x)
            pts = sorted(p for p in pts if getattr(p, "is_real", None) is not False)
            if len(pts) < 2:
                raise ValueError(f"expected 2 real intersection points, got {pts}")
            lower, upper = pts[0], pts[-1]
        else:
            lower = sp.sympify(givens["lower"])
            upper = sp.sympify(givens["upper"])

        mid = (lower + upper) / 2
        diff_at_mid = (f - g).subs(x, mid)
        integrand = (f - g) if diff_at_mid >= 0 else (g - f)
        return _num(sp.integrate(integrand, (x, lower, upper)), sp)

    def limit_evaluation(givens):
        """givens = {"expr": "sin(3*x)/x", "point": "0", "direction": "both"|"+"|"-"}"""
        expr = sp.sympify(givens["expr"])
        point = sp.sympify(givens["point"])
        direction = givens.get("direction", "both")
        if direction == "both":
            return _num(sp.limit(expr, x, point), sp)
        return _num(sp.limit(expr, x, point, dir=direction), sp)

    def definite_integral(givens):
        """givens = {"expr": "sin(x)**8", "lower": "0", "upper": "pi/2"}"""
        expr = sp.sympify(givens["expr"])
        lower = sp.sympify(givens["lower"])
        upper = sp.sympify(givens["upper"])
        return _num(sp.integrate(expr, (x, lower, upper)), sp)

    def derivative_at_point(givens):
        """givens = {"expr": "x**x", "point": "1", "order": 1}"""
        expr = sp.sympify(givens["expr"])
        order = int(givens.get("order", 1))
        d = expr
        for _ in range(order):
            d = sp.diff(d, x)
        return _num(d.subs(x, sp.sympify(givens["point"])), sp)

    def circle_radius(givens):
        """
        givens = {"mode": "general", "D": "-4", "E": "6", "F": "3"}
          -> x^2+y^2+Dx+Ey+F=0, returns radius
        or
        givens = {"mode": "diameter_endpoints", "p1": [1,2], "p2": [3,4]}
        """
        mode = givens.get("mode")
        if mode == "general":
            D, E, F = (sp.sympify(givens[k]) for k in ("D", "E", "F"))
            g, f = D / 2, E / 2
            r_sq = g ** 2 + f ** 2 - F
            if r_sq.is_number and r_sq < 0:
                raise ValueError("negative radius^2 — not a real circle")
            return _num(sp.sqrt(r_sq), sp)
        if mode == "diameter_endpoints":
            (x1, y1), (x2, y2) = givens["p1"], givens["p2"]
            d = sp.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
            return _num(d / 2, sp)
        raise ValueError(f"unknown circle_radius mode: {mode!r}")

    def matrix_det_or_inverse(givens):
        """
        givens = {"matrix": [[1,2],[3,4]], "op": "det"}
        or       {"matrix": [[...]], "op": "inverse_entry", "entry": [0,1]}
        """
        M = sp.Matrix(givens["matrix"])
        op = givens.get("op")
        if op == "det":
            return _num(M.det(), sp)
        if op == "inverse_entry":
            i, j = givens["entry"]
            return _num(M.inv()[i, j], sp)
        raise ValueError(f"unknown matrix op: {op!r}")

    def linear_ode_value(givens):
        """
        First-order linear ODE y' + P(x) y = Q(x), y(x0)=y0, evaluated at eval_at.
        givens = {"P_expr": "1/x", "Q_expr": "x", "x0": "1", "y0": "0", "eval_at": "2"}
        """
        y = sp.Function("y")
        P = sp.sympify(givens["P_expr"])
        Q = sp.sympify(givens["Q_expr"])
        ode = sp.Eq(sp.Derivative(y(x), x) + P * y(x), Q)
        sol = sp.dsolve(ode, y(x))
        C1 = sp.symbols("C1")
        x0, y0 = sp.sympify(givens["x0"]), sp.sympify(givens["y0"])
        const_candidates = sp.solve(sp.Eq(sol.rhs.subs(x, x0), y0), C1)
        if not const_candidates:
            raise ValueError("could not solve for integration constant")
        y_expr = sol.rhs.subs(C1, const_candidates[0])
        return _num(y_expr.subs(x, sp.sympify(givens["eval_at"])), sp)

    return {
        "area_between_curves": area_between_curves,
        "limit_evaluation": limit_evaluation,
        "definite_integral": definite_integral,
        "derivative_at_point": derivative_at_point,
        "circle_radius": circle_radius,
        "matrix_det_or_inverse": matrix_det_or_inverse,
        "linear_ode_value": linear_ode_value,
    }


def verify(payload: dict) -> dict:
    archetype = payload.get("archetype")
    givens = payload.get("givens")
    claimed = payload.get("claimed_answer")

    try:
        import sympy as sp  # noqa: F401 local import — see "sympy_unavailable" handling below
    except Exception as exc:  # noqa: BLE001
        return {
            "verified": None,
            "computed_answer": None,
            "claimed_answer": claimed,
            "delta": None,
            "note": f"sympy_unavailable: {exc}",
        }

    archetypes = _build_archetypes(sp)

    if not archetype or archetype not in archetypes or not isinstance(givens, dict):
        return {
            "verified": None,
            "computed_answer": None,
            "claimed_answer": claimed,
            "delta": None,
            "note": (
                f"archetype {archetype!r} not machine-checkable (known: "
                f"{sorted(archetypes)}) — not auto-rejected, self-audit remains sole gate."
            ),
        }

    try:
        computed = archetypes[archetype](givens)
    except Exception as exc:  # noqa: BLE001
        return {
            "verified": False,
            "computed_answer": None,
            "claimed_answer": claimed,
            "delta": None,
            "note": f"verification raised {type(exc).__name__}: {exc} — treated as reject",
        }

    if claimed is None:
        return {
            "verified": None,
            "computed_answer": computed,
            "claimed_answer": None,
            "delta": None,
            "note": "no claimed_answer supplied to compare against",
        }

    try:
        claimed_f = float(claimed)
    except (TypeError, ValueError):
        return {
            "verified": None,
            "computed_answer": computed,
            "claimed_answer": claimed,
            "delta": None,
            "note": f"claimed_answer {claimed!r} is not numeric — cannot compare",
        }

    delta = abs(computed - claimed_f)
    ok = delta <= _tolerance(computed)
    return {
        "verified": ok,
        "computed_answer": computed,
        "claimed_answer": claimed_f,
        "delta": delta,
        "note": "match" if ok else "MISMATCH — skeleton's claimed answer is wrong",
    }


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw or "{}")
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({
            "verified": None,
            "computed_answer": None,
            "claimed_answer": None,
            "delta": None,
            "note": f"invalid_json: {exc}",
        }))
        return 0

    try:
        result = verify(payload)
    except Exception:  # noqa: BLE001 — never let an unexpected error crash the pipeline
        result = {
            "verified": None,
            "computed_answer": None,
            "claimed_answer": payload.get("claimed_answer"),
            "delta": None,
            "note": f"unexpected_error: {traceback.format_exc(limit=2)}",
        }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
