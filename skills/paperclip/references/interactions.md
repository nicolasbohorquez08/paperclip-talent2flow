# Issue-Thread Interactions

Issue-thread interactions are first-class cards that render in the issue thread and capture a typed board/user response. Use them instead of asking the board to type yes/no or a checklist in markdown — interactions create audit trails, drive idempotency, and wake the assignee through a structured continuation path.

## Kinds Comparison

| Kind                            | When to use                                                                                  | When **not** to use                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `request_confirmation`          | Single yes/no decision bound to a target (e.g. accept a plan revision, approve a launch).    | Multi-select choices, free-form answers, or proposing tasks the board can pick from.               |
| `request_checkbox_confirmation` | Board must select any subset of a known list (up to 200 options) and then confirm or reject. | Yes/no decisions (use `request_confirmation`), or proposing new tasks (use `suggest_tasks`).        |
| `ask_user_questions`            | Short structured form: a handful of typed questions, each with answers/options/text.         | Selecting many items from a long list, or single accept/reject decisions.                          |
| `suggest_tasks`                 | Proposing concrete tasks for the board to accept; accepted tasks become real subtasks.       | Asking the board to confirm a plan or arbitrary selection. Tasks are the unit; not arbitrary ids.  |

## Key Shared Semantics

- **Continuation policy.** `request_checkbox_confirmation` defaults to `wake_assignee`, which wakes you after the board resolves the selection. `request_confirmation` defaults to `none`, so set `wake_assignee` or `wake_assignee_on_accept` when you need to resume after a yes/no decision. `none` never wakes you — only use it when you truly do not need to resume.
- **Target binding and staleness.** `request_confirmation` and `request_checkbox_confirmation` both accept a `target` (typically `{ type: "issue_document", key, revisionId, … }`). When a newer revision lands, Paperclip expires the pending interaction with `outcome: "stale_target"`. Rebuild against the latest revision and create a fresh interaction.
- **Supersede on user comment.** Both confirmation kinds default `supersedeOnUserComment: true`, so a later board/user comment cancels the pending request with `outcome: "superseded_by_comment"`. On the wake, address the comment and create a new interaction if approval is still required.
- **Idempotency.** Use a deterministic `idempotencyKey` such as `confirmation:${issueId}:plan:${revisionId}` or `checkbox:${issueId}:${decisionKey}:${revisionId}` so retries do not stack duplicate cards.
- **Source issue posture.** After creating a pending interaction, move the source issue to `in_review` with a comment that names what the board must decide. The pending interaction is the explicit waiting path.

## Example: request_checkbox_confirmation

```json
POST /api/issues/{issueId}/interactions
{
  "kind": "request_checkbox_confirmation",
  "idempotencyKey": "checkbox:{issueId}:cleanup-files:{planRevisionId}",
  "title": "Confirm files to delete",
  "summary": "Pick the files you want removed before I run the cleanup.",
  "continuationPolicy": "wake_assignee",
  "payload": {
    "version": 1,
    "prompt": "Check the files you want deleted.",
    "detailsMarkdown": "I will run the deletion against everything you check, then report back here.",
    "options": [
      { "id": "draft-report-march", "label": "Old draft report", "description": "QA test pass, March." },
      { "id": "tmp-export-2025", "label": "tmp/export-2025.csv" }
    ],
    "defaultSelectedOptionIds": ["draft-report-march"],
    "minSelected": 0,
    "maxSelected": null,
    "acceptLabel": "Delete selected",
    "rejectLabel": "Request changes",
    "rejectRequiresReason": true,
    "rejectReasonLabel": "What should change?",
    "supersedeOnUserComment": true,
    "target": {
      "type": "issue_document",
      "issueId": "{issueId}",
      "key": "plan",
      "revisionId": "{latestPlanRevisionId}"
    }
  }
}
```

When the board accepts, your wake delivers `result.selectedOptionIds` — the option ids they picked (which may be empty if `minSelected: 0`). Rejection delivers `result.reason` and a `commentId`.

For full payload schemas, validation limits (option count, label lengths, min/max rules), accept/reject route bodies, and result fields, see `references/api-reference.md` -> **Checkbox confirmations**.
