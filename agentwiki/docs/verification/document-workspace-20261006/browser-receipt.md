# Browser acceptance checklist

Target flow: isolated local Space → read/edit rich Markdown → manual tools and tree actions → explicit local draft recovery → staged/scoped Assist candidate review without overwriting typing.

| Flow | Required evidence | State |
| --- | --- | --- |
| Page identity and rendering | localhost URL/title, meaningful DOM, no framework overlay or relevant console errors | pending |
| Read / edit continuity | desktop screenshot pair, current paragraph visible after mode switch | pending |
| Manual toolbar | Chinese selection bold, undo restores exact source, page-link insertion | pending |
| Slash insertion | keyboard table/code insertion and caret, Escape and composition guard | pending |
| Outline | code fences excluded, duplicate headings, navigation in read and edit | pending |
| Tree operations | named menu, inline rename/create, intended parent, filter scope, current-page reveal | pending |
| Tree preferences | resize, refresh expand/scroll/width restore, narrow layout | pending |
| Local draft | edit then reload, explicit recover/discard, saved status differs from server save | pending |
| Assist candidate | labelled simulated task stream, no draft change, diff accept/discard, manual typing conflict | pending |
| Scoped Assist / comments | selection context, out-of-scope rejection, independent edit retained, note lifecycle | pending |
| Responsive | desktop + narrow viewport, no clipping/overlap/scroll trap | pending |

Evidence boundaries: fixture Agent output is not live-provider acceptance; composition-event guard is not native IME acceptance; no production document changes or deployment.

## Intermediate Task1 browser receipt (2026-10-06)

IAB tab5, localhost63438, product Task1 33c5547f. Existing local API from build before Task5; directory Task2 c268fd83. Explicit task `模拟验收：生成一个用于候选审阅和撤销的测试段落`, real POST creates task, private fixture script writes only AssistTask and isolated Redis stream/complete. No external provider/no page save.

- Stream: candidate diff appears, Save remains disabled.
- Done: Accept enabled, Save remains disabled.
- Explicit Accept: source includes fixture section, Save enabled.
- Ctrl/Cmd+Z: candidate section gone; clipboard whole editor source matches real authenticated API page content exactly (1636 bytes, SHA256219ebf2d2a117459ed62c6c5a8566590346311ad2f9a8a0cf3a1d9d24a8fe0dd).
- Duplicate complete after undo: source still lacks fixture section; Accept count0.
- Save remains enabled after undo back to baseline (preexisting dirty-flag semantics; Task4 should ensure accurate persisted local-draft status).
- Screenshot paths /tmp/agentwiki-document-workspace-ui-evidence/{before-canvas,before-edit,candidate-before-accept,candidate-after-undo}.jpg.
- Console baseline empty; live HMR transient SpaceView hook-order error recovered by cold reload, final cold all-feature check still pending.

## Intermediate Task3/Task2 acceptance (592470e9)
- Folder inline rename `目录体验验收`→`目录重命名已验收` completed against isolated API, current editor URL/selected page retained.
- Loaded-items filter hides nonmatches, clearing restores folder; keyboard separator ArrowRight260→270 observed aria-valuenow.
- Edit outline lists both repeated headings and no fenced pseudo-heading; selecting last repeated heading focuses second source occurrence.
- Actual authorized page picker loaded fixture page, inserted pageId wiki-link; one undo restored source750 UTF16units (1636UTF8bytes baseline).
- Slash keyboard Down×4+Enter inserted table; one undo restored literal slash.
- Browser defect: slash menu recttop718.75 bottom991.75 in720px viewport, screenshot `/tmp/agentwiki-document-workspace-ui-evidence/slash-bottom-clipped.jpg`. Fix pending.
- Temporary390×844 viewport inspected; header wraps, directory drawer entry available. Do not claim final narrow pass until finalized code.
- Reload command during dirty session did not demonstrably reset source; no draft-persistence claim.

## New isolated fixture (server c773037f; UI4dd0294a)
- localhost59105 realAPI new folder目录功能验收 + child page手工编辑验收 (page65181d25-fba7-4f8f-b013-74d789251131), parent breadcrumb/tree selected correct. Keyboard Enter opens folder operation menu.
- UI source Chinese+headings entered;Save success;reload actual API retained text.
- Full source selection→Bold adds only `**` wrappers;oneUndo exact byte/string restored.
- Directorywidth End→420;reload aria420 andexpandedfolder stillpresent; Home→220.
- Fixedslash bottomdesktop rect420.25..693.25 in720px;390px viewport settledrect555..828 in844px/right236<390. Fixed screenshot slash-bottom-fixed.jpg.
- At1680px,canvas860px maintained before/afterAssist. Wideoutline body unobstructed but toolbar overlap found, screenshotwide-outline-toolbar-overlap.jpg;repairpending.
- Temporaryviewportreset.

## Task4 functional/browser acceptance (53e5c574)
- Foundandfixedrecoverybuttonnegativeoffsettoolbaroverlap. FinalDOMhit-testcenter='恢复本机草稿'button.
- FreshChinese draft persisted withhonestlocalstatus;newtabserverbaselinehasnodraft,offerpresent;clickRestoreaddscorrectparagraph;SaveAPIshows保存成功,offerabsent. Screenshotdraft-restored-and-saved.jpg.
- Newunsaveddraft basedonoldversion;guardedlocalfixturePATCHadvancedservercontent/version;newtabshowsonlypreview/export/discardandwarning,Restoreabsent,serverparagraphpresent. RealAPItestnotmock.
- Browserreloadwhilebeforunload sometimescancels;newtabusedtocertifyreopen. HMRduringactiveagenteditingresetstate; finalfreezeUIused,notcountedasproddefect.
- Wideoutlinefix3873c954verifiedat1680x1000:EditAssistbuttonbottom210hititself;outline top235 (nooverlap). Screenshotwide-outline-fixed.jpg. Viewportreset.

## Final immutable product receipt (897aa3f8)

- Actual built assets served only on loopback59108 against disposableAPI59104. Login throughUI; PageEditor/editor-core/Markdown scripts HTTP200. Source bold+undo stringexact; JSfenceinsert/undo andpreview/editwork. Coldreloadshowseditorwithoutconsolewarnings/errors. Finalread/edit screenshots retained.
- Desktop1680canvas860;built390viewportdocument.scrollWidth390,notesdrawerx62..382,y110..836within844. Directorydrawerat390verified.
- ScopedtargetrealPOST+fixture stream/done, unrelatedmanualappendretainedonaccept;oneundoexactbaseplushuman. Two-quote notesbatchsimulatedmultiresult: bothawaitingthenaccept1onlynote1resolved,drawerclosehidden:true/display:none, reopeningfirstdisabled/secondactive, accept2secondresolved;undo2preservesfirstchange.
- A later actualSavefromproductionpreview advancesremoteversion; olderdevtabshowsremoteupdatebanner. Attemptacceptoldcandidate: alert says page/permission/version/draftchanged; wholeclipboardsourceexactlyunchanged=true. Screenshotfinal-stale-candidate.png. This is knownremoteversionapplyguard, not provideracceptance.
- Final Agentfixture remains explicitlocaloutput; noexternalmodel. NativeIME/Windows/multipersonstressnotclaimed. Primaryacceptancechecklistaboveisintermediaterecord; finalcoverageisthisreceipt+acceptance.md.
