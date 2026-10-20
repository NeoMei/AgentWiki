# Page Note Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让页面笔记作者选择多个 Space 人类协作人，并为每位协作人生成可读、可点击定位到笔记原文的持久化消息通知。

**Architecture:** 在 Prisma 中增加通用 `UserNotification` 和 `PageNoteRecipient`，由页面笔记创建事务校验 Space 成员并写入通知；通知模块提供当前用户隔离的列表、未读数和已读接口。前端在共用的 `SelectionNoteComposer` 中完成 `@` 搜索和多人选择，在 Navbar 显示通知入口，并通过 `/pages/:pageId?note=:noteId` 让 `PagePreview` 打开笔记栏并定位原文。

**Tech Stack:** NestJS、Prisma/PostgreSQL、React、React Router、Axios、Vitest/Testing Library、Tailwind CSS。

**Spec:** `docs/superpowers/specs/2026-10-21-page-note-notifications-design.md`

## Global Constraints

- 协作人只来自当前 Space 的人类成员；Agent 不进入选择列表，也不收到本次通知。
- 作者本人不生成通知；同一笔记对同一收件人只生成一次。
- 笔记、协作人关系和通知在同一 Prisma transaction 内写入；`clientNoteId` 重试保持幂等。
- 通知查询只返回当前用户仍有页面读取权限的通知，不能泄露失权页面的标题或摘要。
- 通知点击使用 `/pages/<pageId>?note=<pageNoteId>`，页面在笔记数据加载后打开笔记栏并定位原文。
- 不增加邮件、Web Push、短信、Agent 收件箱或通知偏好设置。

---

### Task 1: 持久化模型和通知服务端模块

**Files:**
- Create: `apps/server/prisma/migrations/<timestamp>_page_note_notifications/migration.sql`
- Modify: `apps/server/prisma/schema.prisma` (`User`, `PageNote`, new `PageNoteRecipient`, new `UserNotification`)
- Create: `apps/server/src/notifications/notification.schema.ts`
- Create: `apps/server/src/notifications/notification.service.ts`
- Create: `apps/server/src/notifications/notification.controller.ts`
- Create: `apps/server/src/notifications/notification.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Test: `apps/server/src/notifications/notification.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuthorizationService`, `Principal`, `Page`/`SpaceMember` relations.
- Produces: `NotificationService.createPageNoteNotifications(tx, input)`, `GET /notifications`, `PATCH /notifications/:id/read`, and `POST /notifications/read-all`.

- [ ] **Step 1: Write service and controller failing tests**

  Add tests for these observable contracts:

  ```ts
  it('lists only visible notifications for the current recipient', async () => {
    const result = await service.list({ userId: 'u1' }, { unreadOnly: false, limit: 20 });
    expect(result).toMatchObject({ unreadCount: 1, notifications: [{ pageId: 'p1', pageNoteId: 'n1' }] });
    expect(prisma.userNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ recipientUserId: 'u1', page: expect.anything() }),
    }));
  });

  it('marks only the current user notification as read and is idempotent', async () => {
    await service.markRead({ userId: 'u1' }, 'notification-1');
    expect(prisma.userNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'notification-1', recipientUserId: 'u1', readAt: null },
    }));
  });

  it('creates one notification per new recipient and skips the author', async () => {
    await service.createPageNoteNotifications(tx, {
      noteId: 'n1', pageId: 'p1', spaceId: 's1', authorUserId: 'u1', recipientUserIds: ['u1', 'u2', 'u2'],
      pageTitle: 'Page', body: 'A note', quote: 'quoted',
    });
    expect(tx.pageNoteRecipient.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [{ noteId: 'n1', userId: 'u2' }] }));
    expect(tx.userNotification.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ recipientUserId: 'u2' })] }));
  });
  ```

- [ ] **Step 2: Run the focused tests and verify they fail**

  Run: `pnpm --filter @agentwiki/server test -- notifications/notification.service.spec.ts --runInBand`

  Expected: FAIL because the new module, models, and service methods do not exist.

- [ ] **Step 3: Add the Prisma models and migration**

  Add `User.notifications`, `PageNote.recipients`, and the following models:

  ```prisma
  model PageNoteRecipient {
    id        String   @id @default(cuid())
    note      PageNote @relation(fields: [noteId], references: [id], onDelete: Cascade)
    noteId    String
    user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId    String
    createdAt DateTime @default(now())

    @@unique([noteId, userId])
    @@index([userId, createdAt])
  }

  model UserNotification {
    id              String    @id @default(cuid())
    recipient       User      @relation("NotificationRecipient", fields: [recipientUserId], references: [id], onDelete: Cascade)
    recipientUserId String
    actor           User?     @relation("NotificationActor", fields: [actorUserId], references: [id], onDelete: SetNull)
    actorUserId     String?
    spaceId         String
    page            Page      @relation(fields: [pageId, spaceId], references: [id, spaceId], onDelete: Cascade)
    pageId          String
    pageNote        PageNote @relation(fields: [pageNoteId], references: [id], onDelete: Cascade)
    pageNoteId      String
    type            String
    title           String
    body            String
    payload         Json
    readAt          DateTime?
    createdAt       DateTime  @default(now())

    @@unique([type, pageNoteId, recipientUserId])
    @@index([recipientUserId, readAt, createdAt])
  }
  ```

  Generate the SQL migration from the schema or write equivalent SQL, then run `pnpm --filter @agentwiki/server prisma:generate` (or the repository's existing Prisma generate command) before compiling.

- [ ] **Step 4: Implement the notification service and routes**

  `NotificationService.list(principal, { unreadOnly, limit })` must query `recipientUserId = principal.userId`, `page.deletedAt = null`, and a current `page.space.members.some.userId = principal.userId`; return `unreadCount`, notification summaries, `pageId`, `pageNoteId`, and `href`.

  `createPageNoteNotifications(tx, input)` must de-duplicate recipient ids, remove `authorUserId`, verify all ids against `SpaceMember` joined to a human `User`, create `PageNoteRecipient` rows and snapshot notification text in the same transaction. Reject invalid ids with a bad-request business error. `markRead` and `markAllRead` must scope updates to the current human principal.

- [ ] **Step 5: Run focused server tests and type checks**

  Run: `pnpm --filter @agentwiki/server test -- notifications/notification.service.spec.ts --runInBand` and `pnpm --filter @agentwiki/server typecheck`.

  Expected: PASS with no Prisma or Nest dependency errors.

- [ ] **Step 6: Commit the server foundation**

  ```bash
  git add apps/server/prisma apps/server/src/notifications apps/server/src/app.module.ts
  git commit -m "feat: add persisted page note notifications"
  ```

### Task 2: Page-note recipient validation and composer selection

**Files:**
- Modify: `apps/server/src/page-notes/page-note.schema.ts`
- Modify: `apps/server/src/page-notes/page-note.service.ts`
- Modify: `apps/server/src/page-notes/page-note.module.ts`
- Modify: `apps/client/src/features/page/pageNotesApi.ts`
- Modify: `apps/client/src/features/page/usePersonalNotes.ts`
- Modify: `apps/client/src/features/page/SelectionNoteComposer.tsx`
- Modify: `apps/client/src/features/page/PagePreview.tsx`
- Modify: `apps/client/src/features/page/PageEditor.tsx`
- Create: `apps/client/src/features/page/NoteCollaboratorPicker.tsx`
- Test: `apps/server/src/page-notes/page-note.service.spec.ts`
- Test: `apps/client/src/features/page/NoteCollaboratorPicker.spec.tsx`
- Test: `apps/client/src/features/page/SelectionNoteComposer.spec.tsx`

**Interfaces:**
- Consumes: `NotificationService.createPageNoteNotifications`, `collaborationApi.listMembers`, `SpaceMemberSummary`.
- Produces: `CreatePageNote.recipientUserIds?: string[]`; `usePersonalNotes.add(target, body, { requirePersistence, recipientUserIds })`.

- [ ] **Step 1: Add failing API/service tests for recipient validation**

  Extend the page-note tests with:

  ```ts
  it('rejects agent ids and users outside the page Space', async () => {
    await expect(service.create(principal, 's1', 'p1', { ...validInput, recipientUserIds: ['agent-1'] }))
      .rejects.toMatchObject({ code: 'PAGE_NOTE_RECIPIENT_INVALID' });
  });

  it('passes verified recipient ids to the notification transaction', async () => {
    await service.create(principal, 's1', 'p1', { ...validInput, recipientUserIds: ['u2'] });
    expect(notificationService.createPageNoteNotifications).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientUserIds: ['u2'] }));
  });
  ```

- [ ] **Step 2: Run focused tests and verify they fail**

  Run: `pnpm --filter @agentwiki/server test -- page-notes/page-note.service.spec.ts --runInBand`.

  Expected: FAIL because strict input parsing and transaction creation do not yet know `recipientUserIds`.

- [ ] **Step 3: Extend the strict schema and page-note transaction**

  Add `recipientUserIds: z.array(id).max(50).optional().default([])` to `NOTE_CREATE_FIELDS`. In `PageNoteService.create`, after locking the page, fetch and validate current human Space members, create the note, create recipient rows and notifications through `NotificationService`, and return the existing projected note. The existing idempotent branch must return before notification creation.

- [ ] **Step 4: Add the collaborator picker**

  Implement `NoteCollaboratorPicker` with props:

  ```ts
  interface NoteCollaboratorPickerProps {
    spaceId: string;
    selectedUserIds: string[];
    onChange: (userIds: string[]) => void;
    language: string;
    disabled?: boolean;
  }
  ```

  Load `collaborationApi.listMembers(spaceId)`, filter `type === 'human'` and `user`, search by trimmed name/email, support `@` input and click-to-open, render selected chips with remove buttons, and show a loading/error state without blocking note text. Do not place display names in the create payload.

- [ ] **Step 5: Thread selected ids through the note composer**

  Add `recipientUserIds` state to `SelectionNoteComposer`, render the picker in the expanded form, clear it in `close`, and call `onAdd(target, body, recipientUserIds)`. Update both PagePreview and PageEditor to pass `spaceId` and extend the `onAdd` callback to `personalNotes.add`.

  Update `usePersonalNotes.add` and `pageNotesApi.create` to send `recipientUserIds`, preserving the existing retry/draft behavior. A failed request must retain the body and selected ids until the composer closes or retries.

- [ ] **Step 6: Run client and server focused tests**

  Run: `pnpm --filter @agentwiki/client test -- NoteCollaboratorPicker SelectionNoteComposer` and `pnpm --filter @agentwiki/server test -- page-notes/page-note.service.spec.ts --runInBand`.

  Expected: PASS for multi-select, removal, strict payload, author filtering, and retry retention.

- [ ] **Step 7: Commit the note collaboration slice**

  ```bash
  git add apps/server/src/page-notes apps/client/src/features/page
  git commit -m "feat: select collaborators on page notes"
  ```

### Task 3: Notification client, Navbar, and history page

**Files:**
- Create: `apps/client/src/features/notifications/notificationsApi.ts`
- Create: `apps/client/src/features/notifications/NotificationsPage.tsx`
- Create: `apps/client/src/features/notifications/NotificationBell.tsx`
- Modify: `apps/client/src/components/Navbar.tsx`
- Modify: `apps/client/src/App.tsx`
- Test: `apps/client/src/features/notifications/NotificationBell.spec.tsx`
- Test: `apps/client/src/features/notifications/notificationsApi.spec.ts`

**Interfaces:**
- Consumes: `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`.
- Produces: `NotificationBell` with polling, unread badge, dropdown navigation, and `/notifications` history route.

- [ ] **Step 1: Write failing API and bell tests**

  Test that the API maps `href` and unread count, the bell polls while authenticated, renders a badge, marks a clicked item read before navigation, and does not show another user's notification.

- [ ] **Step 2: Run focused client tests and verify they fail**

  Run: `pnpm --filter @agentwiki/client test -- notificationsApi NotificationBell`.

  Expected: FAIL because the notification client and components do not exist.

- [ ] **Step 3: Implement the notification API**

  Define:

  ```ts
  export interface UserNotification { id: string; type: 'page_note_mention'; title: string; body: string; pageId: string; pageNoteId: string; href: string; createdAt: string; readAt: string | null; }
  export interface NotificationList { unreadCount: number; notifications: UserNotification[]; }
  export const notificationsApi = {
    list: (params?: { unreadOnly?: boolean; limit?: number }, signal?: AbortSignal) => Promise<NotificationList>,
    markRead: (id: string) => Promise<void>,
    markAllRead: () => Promise<void>,
  };
  ```

- [ ] **Step 4: Implement the bell and history page**

  Reuse Navbar's existing 5-second review polling pattern: refresh on mount, focus, visibility, and route changes; clear on logout; retain the last successful count on transient failure. `NotificationBell` shows a dropdown of recent notifications and a link to `/notifications`. Clicking an item calls `markRead`, then `navigate(notification.href)`; failed mark-read still navigates. `NotificationsPage` supports unread filtering, mark-all-read, loading/empty/error states, and links each item through the same handler.

- [ ] **Step 5: Add the protected route and Navbar integration**

  Add a lazy `NotificationsPage` import and `/notifications` route inside the existing protected `Layout`. Add `NotificationBell` beside search/review navigation without changing the existing review count behavior.

- [ ] **Step 6: Run focused tests and commit**

  Run: `pnpm --filter @agentwiki/client test -- notificationsApi NotificationBell` and `pnpm --filter @agentwiki/client typecheck`.

  ```bash
  git add apps/client/src/features/notifications apps/client/src/components/Navbar.tsx apps/client/src/App.tsx
  git commit -m "feat: add notification inbox and navbar badge"
  ```

### Task 4: Deep-link page-note activation and end-to-end client coverage

**Files:**
- Modify: `apps/client/src/features/page/PagePreview.tsx`
- Test: `apps/client/src/features/page/PagePreview.spec.tsx`
- Test: `apps/client/src/features/page/pageNotesApi.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `/pages/:pageId?note=:pageNoteId`, `personalNotes.loaded`, `noteHighlights`, `activateNote`.
- Produces: stable page-load behavior that opens the notes panel and activates only a note belonging to the loaded page.

- [ ] **Step 1: Add a failing deep-link test**

  Render `PagePreview` at `/pages/p1?note=n1` with the notes API returning `n1`; assert the notes panel opens and the note card receives the active state. Add a second case where `note=n2` is not returned and assert the page remains usable without activating a foreign note.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `pnpm --filter @agentwiki/client test -- PagePreview --run`.

  Expected: FAIL because the query parameter is currently ignored.

- [ ] **Step 3: Implement query-driven activation**

  Use `useSearchParams` or the existing `location` object. After `page.id === id`, `personalNotes.loaded`, and `noteHighlights` are ready, read `note`; call `activateNote(noteId)` only when the id exists in `noteHighlights`. Clear the query with `setSearchParams({}, { replace: true })` after successful activation so refreshes do not replay it. Do not alter the existing hash-scroll effect.

- [ ] **Step 4: Run page and related client tests**

  Run: `pnpm --filter @agentwiki/client test -- PagePreview pageNotesApi` and `pnpm --filter @agentwiki/client typecheck`.

  Expected: PASS, including existing hash scrolling, note locating, selection composer, and route restoration tests.

- [ ] **Step 5: Commit the deep-link slice**

  ```bash
  git add apps/client/src/features/page/PagePreview.tsx apps/client/src/features/page/PagePreview.spec.tsx apps/client/src/features/page/pageNotesApi.spec.ts
  git commit -m "feat: deep link notifications to page notes"
  ```

### Task 5: Whole-branch review, migration verification, and release

**Files:**
- Modify: `docs/verification/` with a dated verification note
- Review: all commits from Tasks 1-4

- [ ] **Step 1: Run repository validation**

  Run the repository's required checks from the active worktree: `pnpm lint`, `pnpm typecheck`, server/client test suites, and the production Prisma migration dry-run or equivalent configured check. Fix failures before continuing.

- [ ] **Step 2: Review security and concurrency boundaries**

  Confirm every notification endpoint scopes by `principal.userId`, page-note creation validates current `SpaceMember` rows, invalid recipients cannot be used to probe membership, duplicate note retries do not duplicate notification rows, and page access is rechecked after notification navigation.

- [ ] **Step 3: Verify production migration and browser behavior**

  Deploy the candidate through the repository's `deploy.sh` flow, run `/health`, verify Prisma migration status and service logs, then use the logged-in AgentWiki browser to create a note as one member selecting at least two collaborators. Verify each collaborator sees exactly one unread notification, click it, confirm `/pages/<id>` opens the notes panel and highlights the note, mark read, and verify unread count/read state. Verify a removed/non-member account cannot list the notification or page.

- [ ] **Step 4: Write the verification record and review the final diff**

  Record candidate commit, migration name, test commands/results, health response, browser actions, and any remaining limits under `docs/verification/2026-10-21-page-note-notifications/`. Ensure no secrets or raw notification payloads are committed.

- [ ] **Step 5: Commit verification and publish**

  ```bash
  git add docs/verification/2026-10-21-page-note-notifications
  git commit -m "docs: verify page note notification release"
  ```

  Only after all checks pass, run the approved AgentWiki release/deploy command and read back the production health and browser result. If any check fails, keep the branch unreleased and fix the failing task.
