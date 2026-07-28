"""
SymPy symbolic verification sidecar for Math MCQs.

Input JSON (stdin):
{
  "expression": "solve(x**2 - 4, x)",
  "expected": "2",
  "mode": "numeric" | "equals"
}

Output JSON (stdout):
{ "ok": true|false, "value": "...", "error": null|"..." }
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw or "{}")
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "value": None, "error": f"invalid_json: {exc}"}))
        return 0

    expression = str(payload.get("expression") or "").strip()
    expected = str(payload.get("expected") or "").strip()
    mode = str(payload.get("mode") or "numeric").strip().lower()

    if not expression:
        print(json.dumps({"ok": False, "value": None, "error": "empty_expression"}))
        return 0

    try:
        import sympy as sp
        from sympy.parsing.sympy_parser import (
            implicit_multiplication_application,
            parse_expr,
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
        expr = parse_expr(expression, transformations=transforms)
        value = sp.N(expr) if mode != "equals" else expr
        value_s = str(value)
        if not expected:
            print(json.dumps({"ok": True, "value": value_s, "error": None}))
            return 0

        expected_expr = parse_expr(expected, transformations=transforms)
        if mode == "equals":
            ok = bool(sp.simplify(expr - expected_expr) == 0)
        else:
            try:
                ok = abs(float(sp.N(expr)) - float(sp.N(expected_expr))) <= 1e-6 * max(
                    1.0, abs(float(sp.N(expected_expr)))
                )
            except Exception:
                ok = bool(sp.simplify(expr - expected_expr) == 0)
        print(json.dumps({"ok": ok, "value": value_s, "error": None if ok else "mismatch"}))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "value": None, "error": str(exc)}))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
