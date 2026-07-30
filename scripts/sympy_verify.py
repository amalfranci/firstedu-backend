"""
SymPy symbolic verification sidecar for Math MCQs.

Input JSON (stdin):
{
  "expression": "integrate(x**2, (x, 0, 1))",
  "expected": "1/3",
  "mode": "numeric" | "equals" | "evaluate"
}

Output JSON (stdout):
{ "ok": true|false, "value": "...", "error": null|"...", "method": "simplify"|"numeric_probe"|"eval"|null }
"""

from __future__ import annotations

import json
import random
import sys
from typing import Optional


def _parse(expression: str, transforms):
    from sympy.parsing.sympy_parser import parse_expr

    return parse_expr(expression, transformations=transforms)


def _symbolic_equal(a, b, sp) -> bool:
    try:
        diff = sp.simplify(a - b)
        if diff == 0:
            return True
        if sp.simplify(sp.expand(diff)) == 0:
            return True
        # Trig / log identities
        if bool(sp.trigsimp(diff) == 0):
            return True
    except Exception:
        return False
    return False


def _numeric_probe(a, b, sp, samples: int = 5) -> Optional[bool]:
    """Compare a and b at random real points. None = inconclusive."""
    try:
        free = sorted(list(a.free_symbols | b.free_symbols), key=str)
        if not free:
            return abs(float(sp.N(a)) - float(sp.N(b))) <= 1e-6 * max(
                1.0, abs(float(sp.N(b)))
            )
        # Avoid poles near 0 for rationals — sample away from zero.
        for _ in range(samples):
            subs = {}
            for sym in free:
                # Prefer (0.2, 2.5) and negatives occasionally
                val = random.uniform(0.25, 2.5) * (1 if random.random() > 0.3 else -1)
                subs[sym] = val
            av = complex(sp.N(a.subs(subs)))
            bv = complex(sp.N(b.subs(subs)))
            if abs(av.imag) > 1e-8 or abs(bv.imag) > 1e-8:
                continue
            if abs(av.real - bv.real) > 1e-5 * max(1.0, abs(bv.real)):
                return False
        return True
    except Exception:
        return None


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw or "{}")
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "value": None, "error": f"invalid_json: {exc}"}))
        return 0

    expression = str(payload.get("expression") or "").strip()
    expected = str(payload.get("expected") or "").strip()
    mode = str(payload.get("mode") or "equals").strip().lower()

    if not expression:
        print(json.dumps({"ok": False, "value": None, "error": "empty_expression"}))
        return 0

    try:
        import sympy as sp
        from sympy.parsing.sympy_parser import (
            implicit_multiplication_application,
            standard_transformations,
        )
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "ok": False,
                    "value": None,
                    "error": f"sympy_unavailable: {exc}",
                }
            )
        )
        return 0

    transforms = standard_transformations + (implicit_multiplication_application,)
    try:
        expr = _parse(expression, transforms)
        value = sp.simplify(expr)
        value_s = str(value)

        if not expected or mode == "evaluate":
            print(
                json.dumps(
                    {
                        "ok": True,
                        "value": value_s,
                        "error": None,
                        "method": "eval",
                    }
                )
            )
            return 0

        expected_expr = _parse(expected, transforms)

        # Primary: symbolic identity via simplify(A - B) == 0
        if _symbolic_equal(expr, expected_expr, sp) or _symbolic_equal(
            value, sp.simplify(expected_expr), sp
        ):
            print(
                json.dumps(
                    {
                        "ok": True,
                        "value": value_s,
                        "error": None,
                        "method": "simplify",
                    }
                )
            )
            return 0

        # Numeric probe fallback (3–5 random domain points)
        probe = _numeric_probe(expr, expected_expr, sp, samples=5)
        if probe is True:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "value": value_s,
                        "error": None,
                        "method": "numeric_probe",
                    }
                )
            )
            return 0
        if probe is False:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "value": value_s,
                        "error": "mismatch",
                        "method": "numeric_probe",
                    }
                )
            )
            return 0

        # Last resort: float compare of fully evaluated constants
        try:
            ok = abs(float(sp.N(expr)) - float(sp.N(expected_expr))) <= 1e-6 * max(
                1.0, abs(float(sp.N(expected_expr)))
            )
            print(
                json.dumps(
                    {
                        "ok": ok,
                        "value": value_s,
                        "error": None if ok else "mismatch",
                        "method": "numeric",
                    }
                )
            )
            return 0
        except Exception:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "value": value_s,
                        "error": "mismatch",
                        "method": "simplify",
                    }
                )
            )
            return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "value": None, "error": str(exc)}))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
