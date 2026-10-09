# Browser integration pass at bd83b1b7

2026-10-06, production assets at isolated http://127.0.0.1:51894, CUA IAB, desktop1280x720/mobile390x844. No Save invoked. This is an intermediate report; three failures block completion.

## Passed
- Table single cell 小林→小陈: copied source exactly equals baseline with that sole replacement. One Cmd+Z restores entire2520-character source exactly.
- Row down, add row, add column, center alignment, column right: intentional first table changes; prefix and suffix including second table match exactly; one undo restores entire source.
- Existing100-page link list excludes old target; query远古星河 returns real old target0ccbf382-2c8f-4cbf-8316-6debf2d82a33. Inserted WikiLink at captured sentence end; one undo restores full source.
- Outline keyboard width280→290; collaboration notes tab width320→330. Mobile temporary hide/open/dismiss then desktop restores notes+330. Outline unavailable while collaboration open.
- Table dialog itself fits390px (x16..374), actions y593..625; inner cell area scroll454/client324; page width390. Reached via opening at desktop then narrowing because mobile entry is broken below.
- Directory final-row menu opens upward, all buttons y565..665 within720. Manual locate reveals current row (top355..395 within port355..720).
- CRLF fixture table action shows explicit line-ending/source fallback, grid absent, Save disabled. Read-only verify-pages.mjs at11:07:37Z confirms main+CRLF title/content/updatedAt unchanged.

## Confirmed integration failures
1. P2 selection: real keyboard End then Shift+Home selects sentence reverse anchor23/head0. Preview then return without navigating collapses to heading # offset0. AX selectText also reproduced but keyboard evidence is decisive. Source unchanged. PageEditor infers navigation merely from nearest viewport source block; scrollIntoView and toolbar capture boundary differ.
2. P2 mobile table entry: at390 the toolbar wraps67px but index.css:86 absolute inset:-38px leaves only38px before source. Button rect x81,y675,h32 while workspace starts678. elementFromPoint at button center hits cm-line '---'. Actual click changes CM cursor and removes contextual button. Screenshot mobile-toolbar-overlap-before.png.
3. P2 directory transition: main reading→sibling using tree, manually scroll directory5157, browser.back→main. Selected text correct but row y-4624..-4584 outsideport355..720; scroll stays5157 after settled. Reviewer traced page-loading SpaceView branch unmounting Directory, losing local page-change ref. Preserve actual reload scroll behavior while carrying page transition across remount.

## Notes
- Existing editor dirty indicator remains after exact undo; leaving fixture uses explicit browser confirm after source equality verified, no save. Not claimed as new table corruption.
- Screenshots in /tmp/agentwiki-completion-20261006; copy final useful proof only after final fix build/retest.
- Full checks:135client suites1987tests pass; repository typecheck pass; lint0errors/3pre-existing serverwarnings; production build pass initial548326/550000 bytes, unchanged budget and existing Mermaid parser exception.
