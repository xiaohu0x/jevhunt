# JevHunt search journey audit

Audit date: 2026-10-02. Audience: developers looking for Jev applications, integrations, SDKs, local alternatives and research.

## Positioning

JevHunt is an independent, evidence-first directory for Jev projects. The useful promise is that a visitor can find a project by name or task, see the project's relationship to Jev, inspect a pinned source reference and decide what to try next. The site does not certify runtime behavior, security, accuracy or performance.

The homepage now states this directly: **Find JEV AI projects you can verify.** Its supporting copy names the five discovery jobs and the three decision signals shown on each listing: relationship, source evidence and freshness. The TypeSafe boundary remains explicit so an independent project is not mistaken for an official model or SDK.

## Search journey findings

| User behavior | Before | Current behavior |
| --- | --- | --- |
| Repository punctuation, such as `jev mlx` for `JEV-MLX` | Required one continuous substring; natural spacing could return no result | Queries split into terms and normalize repository punctuation, so each term must appear as a word |
| Project name versus broad description matches | Every query used the selected sort, usually stars | Name/repository matches are ranked before description-only matches, while the selected sort remains the tie-breaker |
| Hyphenated integrations, such as `paperclip jev` | Spaces and hyphens did not resolve to the same project identity | Word-boundary search matches `paperclip-plugin-jev` |
| No-result journey | Only an empty sentence | The state keeps the original empty result and offers shorter-query guidance plus relevant English task guides |
| Search starting point | Placeholder named fields only | Placeholder gives a project, task or stack example, including `JEV-MLX` |

The implementation keeps SQL wildcard and path-like input literal, binds every term, preserves URL state and keeps server-rendered results aligned with client hydration. Exact project-name matches are tested before broader text matches.

## Remaining opportunities

1. Use Search Console page/query data after the next observation window to separate brand navigation from task discovery, then tune only pages with meaningful impressions.
2. Add stable category landing copy for the highest-converting tasks, beginning with SDKs, browser agents, local models and paper workflows. Do not generate every filter combination as an indexable page.
3. Add a small set of localized task guides only after native-language query evidence and review are available; the current new guides are international English and their language review is model-only.
4. Track search success, no-result rate, project opens and outbound repository clicks by page type and locale so content expansion follows user decisions rather than page count.

No ranking, traffic, volume or CTR result is inferred from this audit. The owner-provided Search Console screenshot supplied prioritisation evidence; it did not establish long-term demand.
