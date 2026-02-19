# Security Policy

SafeSchool OS is safety-critical software used in schools. We take security vulnerabilities extremely seriously.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Email **security@safeschoolos.com** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for a fix within 5 business days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest `main` branch | Yes |
| Previous releases | Best effort |

## Scope

The following are in scope for security reports:

- Authentication/authorization bypass
- SQL injection, XSS, CSRF
- Sensitive data exposure (PII, credentials)
- 911 dispatch logic errors
- Access control lockdown bypass
- WebSocket authentication issues
- Edge sync data integrity
- FERPA compliance violations

## Disclosure Policy

- We follow coordinated disclosure — please give us reasonable time to fix before public disclosure
- We will credit reporters in the release notes (unless you prefer anonymity)
- We do not offer bug bounties at this time

## Security Architecture

- All user input is sanitized (XSS prevention)
- JWT tokens expire after 24 hours
- Role-based access control (RBAC) on all API routes
- Rate limiting on authentication and sensitive endpoints
- CORS restricted to configured origins in production
- Structured logging with auth headers redacted
- Prisma ORM prevents SQL injection
- Clerk SSO for production authentication
