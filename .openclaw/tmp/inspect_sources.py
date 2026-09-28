import json, sys
d = json.load(sys.stdin)
for s in d["sources"]:
    h = s.get("healthDetail") or {}
    t = s.get("test")
    name = s["name"][:26]
    succ = h.get("success")
    fail = h.get("failure")
    consec = h.get("consecutiveFailures")
    tok = t.get("ok") if t else None
    print("%-28s success=%s failure=%s consec=%s test_ok=%s disabled=%s loadState=%s" % (
        name, succ, fail, consec, tok, s.get("disabled"), s.get("loadState")))
