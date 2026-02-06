# Bug Audit Report - DingDon

**Date**: 2026-02-06
**Audited by**: Claude Code (automated audit)

## Summary

| Priority | Count | Status |
|----------|-------|--------|
| Critical | 5 | See details below |
| High | 5 | See details below |
| Medium | 5 | See details below |

---

## Critical Bugs (Security / Data Loss)

### BUG-001: Workspace verification disabled in notes route
- **File**: `src/app/api/workspaces/[workspaceId]/chat-sessions/[sessionId]/notes/route.ts`
- **Lines**: 23-24, 86-87
- **Issue**: Debug code left in production - "TEMPORAL: Verificacion de workspace deshabilitada para debug"
- **Impact**: Any authenticated user can read/write notes for ANY workspace
- **Fix**: Re-enable workspace membership verification via `workspace_members` table
- **Status**: FIXED

### BUG-002: No authentication on classify-lead endpoint
- **File**: `src/app/api/workspaces/[workspaceId]/classify-lead/route.ts`
- **Issue**: Missing `getServerSession` check - endpoint is publicly accessible
- **Impact**: Anyone can classify leads without being authenticated
- **Fix**: Add session check at the top of the handler
- **Status**: FIXED

### BUG-003: SSRF vulnerability in scrape endpoint
- **File**: `src/app/api/scrape/route.ts`
- **Issue**: Accepts any URL without validating it's external. No timeout on fetch.
- **Impact**: Attacker could scan internal networks (localhost, 192.168.x.x, 10.x.x.x)
- **Fix**: Validate URL hostname against blocklist, add fetch timeout
- **Status**: FIXED

### BUG-004: WhatsApp webhook lacks Twilio signature verification
- **File**: `src/app/api/whatsapp/webhook/route.ts`
- **Issue**: `workspaceId` comes from query params, no verification that request is from Twilio
- **Impact**: Anyone can send fake WhatsApp messages to any workspace
- **Fix**: Validate Twilio request signature using `twilio.validateRequest()`
- **Status**: FIXED

### BUG-005: No workspace authorization on Socket.IO rooms
- **File**: `server.js` (line ~296)
- **Issue**: `join_agent_dashboard` doesn't verify agent belongs to the workspace
- **Impact**: Agent could spy on other workspaces' conversations
- **Fix**: Verify agent's workspace membership before joining dashboard room
- **Status**: FIXED

---

## High Priority Bugs (Broken Functionality / Memory Leaks)

### BUG-006: Agent disconnect doesn't unassign chats
- **File**: `server.js` (line ~952)
- **Issue**: When agent disconnects, chats remain assigned with status 'in_progress'
- **Impact**: Users stuck waiting for a disconnected agent. Other agents can't take those chats
- **Fix**: On disconnect, requeue assigned chats back to 'pending' status
- **Status**: FIXED

### BUG-007: Heartbeat memory leak (duplicate disconnect handlers)
- **File**: `server.js` (lines 952, 975)
- **Issue**: Two separate `disconnect` handlers. Second one's heartbeatInterval is out of scope.
- **Impact**: Heartbeat intervals never cleared - server degrades over time
- **Fix**: Merge both disconnect handlers into one
- **Status**: FIXED

### BUG-008: WhatsApp handoff notification is fire-and-forget
- **File**: `src/app/api/whatsapp/webhook/route.ts` (line ~278)
- **Issue**: `fetch` to notify-handoff has no `await`
- **Impact**: If notification fails silently, user waits forever with no agent notified
- **Fix**: Add `await` and handle errors
- **Status**: FIXED

### BUG-009: Inconsistent status_change event format
- **File**: `server.js` (lines 392, 692, 886, 916, 1030)
- **Issue**: Sometimes emits string ('in_progress'), sometimes object ({status, name, type})
- **Impact**: Client handles both formats but it's fragile. String format loses agent name info
- **Fix**: Standardize all emissions to object format
- **Status**: FIXED

### BUG-010: Agent messages added to UI without server confirmation
- **File**: `src/components/ChatPanel.tsx` (line ~295)
- **Issue**: `addMessageToActiveChat()` runs immediately without waiting for server ack
- **Impact**: If socket.emit fails, message appears sent but never reached the user
- **Fix**: This is a UX tradeoff (optimistic UI). Documented but not changed to avoid latency.
- **Status**: DOCUMENTED (won't fix - optimistic UI pattern is intentional)

---

## Medium Priority Bugs

### BUG-011: No file upload validation (type + size)
- **File**: `src/app/api/me/avatar/route.ts`, `src/app/api/workspaces/[workspaceId]/avatar/route.ts`
- **Issue**: No MIME type or file size validation on uploads
- **Impact**: Can upload malicious files or oversized files
- **Fix**: Validate file type against allowlist and enforce max size
- **Status**: FIXED

### BUG-012: Race condition in invite route
- **File**: `src/app/api/workspaces/[workspaceId]/invite/route.ts` (line 76-81)
- **Issue**: Membership check + insert/update is not atomic
- **Impact**: Concurrent requests could create duplicate memberships
- **Fix**: Use upsert with onConflict
- **Status**: FIXED

### BUG-013: Email hardcoded for single company
- **File**: `src/lib/email/server.ts` (lines 13-19)
- **Issue**: Recipients and sender hardcoded for TSC Seguridad Privada
- **Impact**: Not multi-tenant. All workspaces send to same email addresses
- **Fix**: Load notification config from workspace settings in DB
- **Status**: FIXED

### BUG-014: No timeout on AI API calls
- **File**: `src/services/server/chatbotServiceBackend.ts`
- **Issue**: Calls to Gemini/Kimi/DeepSeek have no timeout
- **Impact**: If API hangs, user sees infinite spinner, server resources tied up
- **Fix**: Add timeout to axios calls, use AbortSignal for Gemini
- **Status**: FIXED

### BUG-015: No rate limiting on public endpoints
- **File**: `/api/chat`, `/api/leads`, `/api/public/config`
- **Issue**: No request rate limiting
- **Impact**: Spam to AI API generates high costs; potential DoS
- **Fix**: Add in-memory rate limiter based on IP
- **Status**: FIXED

---

## Additional Fixes (found during review)

### BUG-016: Handoff email in server.js had hardcoded recipients
- **File**: `server.js` (notify-handoff route, line ~141)
- **Issue**: Email recipients and sender were hardcoded for TSC Seguridad Privada, even though `email/server.ts` was already fixed
- **Impact**: Handoff notification emails always went to same company regardless of workspace
- **Fix**: Load `notification_emails` and `notification_from_email` from workspace DB, fallback to defaults
- **Status**: FIXED

### BUG-017: Dead code - `new_handoff_request` socket handler
- **File**: `server.js` (line ~325)
- **Issue**: Socket listener for `new_handoff_request` was never triggered - handoffs now go through HTTP `/api/internal/notify-handoff`
- **Impact**: Dead code that could cause confusion
- **Fix**: Removed the entire handler
- **Status**: FIXED

### BUG-018: Dead code - `reconnect` socket handler on server
- **File**: `server.js` (line ~954)
- **Issue**: `reconnect` is a client-side event, never fires server-side in Socket.IO
- **Impact**: Dead code
- **Fix**: Removed
- **Status**: FIXED

---

## Pending: Database Migration Required

The following changes require running SQL on the Supabase database:

### 1. Add email notification columns to `workspaces` table
```sql
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS notification_emails text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notification_from_email text DEFAULT NULL;
```
**Why**: BUG-013 and BUG-016 load email recipients dynamically from these columns. Without them, the system falls back to hardcoded defaults (which still works, but defeats the multi-tenant purpose).

### 2. Add unique constraint on `workspace_members` (if not exists)
```sql
ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_workspace_user_unique
  UNIQUE (workspace_id, user_id);
```
**Why**: BUG-012 uses `upsert` with `onConflict: 'workspace_id,user_id'`. If the unique constraint doesn't exist, the upsert will fail.

---

## Files Changed (Summary)

### New files created:
- `src/lib/rateLimit.ts` - In-memory rate limiter
- `docs/bugs/README.md` - This file

### Files modified:
| File | Bugs Fixed |
|------|-----------|
| `src/app/api/workspaces/[workspaceId]/chat-sessions/[sessionId]/notes/route.ts` | BUG-001 |
| `src/app/api/workspaces/[workspaceId]/chat-sessions/[sessionId]/lead-info/route.ts` | BUG-001 |
| `src/app/api/workspaces/[workspaceId]/classify-lead/route.ts` | BUG-002 |
| `src/app/api/scrape/route.ts` | BUG-003 |
| `src/lib/twilio.ts` | BUG-004 |
| `src/app/api/whatsapp/webhook/route.ts` | BUG-004, BUG-008 |
| `server.js` | BUG-005, BUG-006, BUG-007, BUG-009, BUG-016, BUG-017, BUG-018 |
| `src/app/api/me/avatar/route.ts` | BUG-011 |
| `src/app/api/workspaces/[workspaceId]/avatar/route.ts` | BUG-011 |
| `src/app/api/workspaces/[workspaceId]/invite/route.ts` | BUG-012 |
| `src/lib/email/server.ts` | BUG-013 |
| `src/services/server/chatbotServiceBackend.ts` | BUG-014 |
| `src/app/api/chat/route.ts` | BUG-015 |
| `src/app/api/leads/route.ts` | BUG-015 |
