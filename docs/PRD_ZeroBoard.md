PRD: ZeroBoard

Tier 1: Retention & Stickiness (keep users coming back)

1. Comments & Activity Feed
   Your card_activities table already exists but isn't wired up. Card-level comments and an
   activity log ("Card moved from To Do → In Progress") are table stakes for any project
   tool. This is the foundation for collaboration and also helps solo users track their own
   history.

2. Recurring Tasks
   Cards that auto-recreate on a schedule (daily standup prep, weekly review, etc.). This
   turns ZeroClickBoards from a static board into a living system users depend on daily.

3. Board/Card Templates
   Save a board layout or card structure as a template. Reduces friction for repeated
   workflows (sprint boards, content calendars, onboarding checklists). Very high ROI for
   retention.

4. Undo/Redo
   No undo exists currently. Accidental deletes or moves with no recovery erode trust. A
   simple action stack would dramatically improve confidence.

Tier 2: Growth & Differentiation

5. Collaboration & Sharing
   The biggest structural gap. Board sharing with roles (viewer/editor/admin), @mentions,
   and presence indicators. This is what turns a personal tool into a team tool — and team
   tools have much higher retention because switching costs are shared.

6. Notifications Center
   In-app notification feed + optional email digests. "Card assigned to you", "Due date
   approaching", "Comment on your card". Without this, users have to actively check the
   board rather than being pulled back to it.

7. Calendar View
   You have board and timeline views. A month/week calendar view showing cards by due date
   is a natural third view and one of the most requested features in every Kanban tool.

8. Card Dependencies & Relations
   "Blocked by", "Related to", "Parent/child" relationships between cards. This unlocks real
   project management vs. simple task tracking. Your "Blocked" column hints at this need
   but it's manual today.

Tier 3: Power User & Moat Features

9. Automations (Butler-style rules)
   "When a card moves to Done, archive it after 7 days." "When a card is overdue, add the
   red label." Rule-based automations are a massive retention lever — users invest time
   configuring them and won't leave.

10. Custom Fields
    Beyond the 6 fixed label colors — let users add priority dropdowns, story points, custom
    text fields, etc. This lets ZeroClickBoards adapt to any workflow.

11. Import/Export
    Trello JSON import, CSV export, full board backup/restore. Import lowers the barrier to
    switching; export reduces the fear of lock-in. You only have column-level JSON export
    today.

12. Analytics Dashboard
    Cycle time, throughput, cards completed per week, burndown charts. You already have
    Recharts in your dependencies but no analytics UI. This is especially valuable for teams.

13. Integrations
    GitHub (link PRs to cards), Slack (notifications), webhooks (custom integrations). Even
    just a webhook system would let power users connect ZeroClickBoards to anything.

Tier 4: Polish & Trust

14. Offline Support — Service worker + local-first sync so the app works without
    connectivity.

15. Card Sorting — Sort by due date, label, created date, alphabetical. Currently only
    manual DnD ordering.

16. Workspaces — Group boards into workspaces/projects for users with many boards.

17. Tests — No tests exist currently. Not user-facing, but critical for shipping
    confidently as the feature set grows.

---

My Top 3 Recommendations

If I had to pick the highest-leverage items for product life:

1. Comments + Activity Feed — low effort (table exists), unlocks social/collaborative use
2. Recurring Tasks — makes the product a daily habit, not a one-time setup
3. Board Templates — reduces friction, showcases the product's flexibility, great for
   onboarding

Your AI assistant is already a strong differentiator. Leaning into it further (e.g., "AI,
create a sprint retrospective board from template" or "AI, show me overdue cards across
all boards") could compound its value alongside these features.

Want me to plan the implementation for any of these?
