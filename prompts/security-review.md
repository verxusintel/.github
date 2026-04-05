# Security Review Prompt (Opus)

SECURITY REVIEW for VerXus — a threat intelligence SaaS platform.

## Check for:
1. **OWASP Top 10**: injection, broken auth, XSS, SSRF, etc.
2. **Hardcoded secrets**: API keys, tokens, passwords in code
3. **PII logging**: NEVER log emails, IPs, names, CPFs, phone numbers
4. **Missing input validation** on new endpoints
5. **Missing rate limiting** on new endpoints
6. **CSRF protection gaps**
7. **ReDoS-vulnerable regex** patterns
8. **Unsafe deserialization**
9. **Dependencies with known CVEs**
10. **Unpinned dependency versions** (supply chain risk)

## Verdict
- **PASS**: No issues found
- **WARN**: Low/medium issues (informational)
- **FAIL**: High/critical issues — blocks merge
