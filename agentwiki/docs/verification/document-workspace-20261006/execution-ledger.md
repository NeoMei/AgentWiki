# SDD ledger — plan: agentwiki/docs/superpowers/plans/2026-10-06-document-workspace.md

Baseline: c7b89567e50c3749a87b70034357c7e9de226f81. Branch codex/document-workspace.

## Preflight interface and consistency scan

| Tasks | Interface / consistency | Result |
| --- | --- | --- |
| 1 / 3 / 4 / 5 | PageEditor shared | Sequential writes; preserve candidate and draft invariants |
| 1 / 5 | candidate + diff → scoped acceptance and ReviewPage | Task 5 extends existing contract, no second auto-apply path |
| 2 / 3 | workspace preference state → outline | task 3 may read but not rename tree fields |
| 3 / 5 | selection handle → Agent targeting | captureSelection explicit range + original text |
| 1 | stream isolation and stale acceptance tests | agrees |
| 2 | persisted tree + inline mutations + scoped filter | agrees; retain API preconditions |
| 3 | manual controls + shared outline + styling | agrees; style-only changes browser verified |
| 4 | local drafts vs server save | agrees; explicit restore only |
| 5 | scoped Agent + notes + proposal diff | agrees; local personal notes clearly labelled |
| 6 | isolated fidelity and full integration | agrees; no automatic replacement on failed corpus |

Ruling: Personal comments are local, scoped and visibly labelled for this iteration — the approved proposal does not require a shared-comment database; avoids an unreviewed schema/permission expansion — cost if wrong: cross-device/team notes require a follow-up storage migration.
Ruling: Reversible isolated worktree creation and sequential exact-file commits are part of authorized implementation — preserve original branch and prevent staging another agent's work — cost if wrong: changes live in an attached worktree until integrated.

Task 1: baseline focused 5 files / 159 tests passed; implementer assist_candidates dispatched.
Task 1 interface extension: replaceDocument(next):boolean in MarkdownWorkspace handle with explicit undoable transaction; scoped test included. Needed to satisfy approved one-step undo contract; Task 3 must preserve.
Task 2: directory_experience dispatched with exclusive directory/workspace files; independent from Task 1 file set.
Task 3: pending Task 1.
Task 4: pending Task 3.
Task 5: pending Task 4.
Task 6: independent visual-editor probe dispatched; rest pending.

Task 1 dependency extension: promote already-installed @codemirror/commands to explicit client dependency for isolateHistory/undo; exact narrow lockfile change, no upgrades.

Ruling: Tasks 1 and 2 run in parallel with disjoint file ownership, sequential exact-file commits and separate review gates — the active developer multi-agent instruction favors safe parallelism; no downstream shared-file writer starts before prerequisite reviews — cost if wrong: integration/typecheck conflicts require a repair pass.
Task 6 probe: complete, fixed Tiptap 3.31.4; adoption blocked by fidelity (1/17 byte exact; 13/17 normalized renderer meaning); source guard only no-edit. Actual report and reproducible outputs written, pending integration review.

Ruling: Candidate remains reviewable in preview but acceptance requires returning to Edit with visible explanation; no pending implicit apply — preview unmounts EditorView, so this preserves a real one-step undo and single canvas — cost if wrong: one extra mode switch before accepting from preview.
Task 6 probe evidence committed a31620bf; Task1 product review base a31620bf.

Task6 probe run log (globally ignored *.log) explicitly retained in 40b83a7b; controller will use Task1 review base after docs receipts.

Task5 preflight dependency: AssistQueue existing isActive checks status/lease/Space only; extend Task5 owned files to queue+spec for required execution-time requestedByUser/page/Space authorization. Concrete code check, not a new product feature.
Task6 environment: isolated local ready http://127.0.0.1:63438; pid16406, runtime.json0600 with disposable auth; stop kill -TERM16406 then verify schemaCleaned. Browser tab4 bound acceptanceTab, logged in; real rich Markdown renders and no console warnings/errors at baseline. Screenshot /tmp/agentwiki-document-workspace-ui-evidence/before-canvas.jpg.

Task1 commit37efdab7 (base40b83a7b), 185 focused tests/typecheck passed; review_assist_candidates dispatched.
Task5 split: server-only independent slice can proceed with snapshot.assistTarget transport; client slice remains after Task3/4 reviews. Server scope and quote/context/version rules captured in task-5-server-brief.md. Integrated Task5 review still required.

Task1 review1 Important: silent POST catch, no user error feedback. Fix round1 dispatched to original assist_candidates with generation-bound bilingual error + retry/no apply regression.
Task5 server scoped_assist_server dispatched; narrow module/module.spec/controller/controller.spec ownership approved for current authorization DI + requester-private snapshot/result readback.
Browser interim HMR changed SpaceView/useSpaceDirectory hook layout and triggered ErrorBoundary; cold reload recovered. Retest cold finalized Task2, do not count hot-update incident as final regression without reproduction. Current acceptanceTab tab5, IAB session, temp account remains logged in.

Task1 fix round1/5: 1 addressed,0 open; commits37efdab7..33c5547f, panel21/21 and tsc clean.
Task 1: complete (commits40b83a7b..33c5547f, review clean). replaceDocument+candidate guards must be preserved downstream.
Task2 committed c268fd83 base33c5547f;84 tests+tsc clean; review_directory dispatched.
Task5 gateway+focused specs ownership added to keep requester-only streams instead of removing streaming; data must be server-validated, revoked access withheld.

Task2 review1 Important: pending inline-create navigates despite same-Space page navigation; fixround1 original implementer dispatched for route/identity generation + deferred navigation/ABA regression.
Task3 manual_document_canvas implementation underway. Approved lazy on-demand authorized /pages retrieval for functional link picker (no eager fetch; scoped cancellation and honest bounds); optional empty prop alone would not fulfill actual entry.

Task2 fix1 commit9be0af67 basec268fd83;41 covering tests pass; scoped rereview pending.
Task5 server slice commit8ddaf98a base9be0af67;164 passed1 Windows platform skip/typecheck clean; review_scoped_server dispatched. Must preserve snapshot.assistTarget transport and requester-only gateway.

Task2 fix round1/5:1 addressed0 open; c268fd83..9be0af67.
Task 2: complete (commits33c5547f..9be0af67, review clean).
Task4 recoverable_drafts phase1 new storage/helper/spec files only dispatched parallel to Task3. PageEditor integration expressly gated on Task3 review; same Task4 agent resumes then.

Task5 server review Important I1 completion check/write race with revocation/page update (missing existing Space advisory lock), I2 async gateway relay can reorder chunks/complete. Fixround1 dispatched original scoped_assist_server; User→Space lock order and per-task promise serialization+deterministic regressions.
Task4 phase1 complete24 tests+focused lint; no integration pendingTask3gate.
Task5 client scoped_assist_client phase1 new helpers/personal-notes modules and ReviewPage only dispatched. PageEditor/AgentAssistPanel/candidate integration gatedTask4.
Ruling: Parallelize independent Task5 helpers and ReviewPage while shared editor integration waits — files do not overlap Tasks3/4 — cost if wrong: later interface adaptation, no shared write races.

Task3 commit592470e9 base8ddaf98a;9suites265tests,typecheck/diff clean. Independent review_manual_canvas dispatched. Controller browser found slash menu offscreen at bottom (1280x720 top718.75 bottom991.75), passed to reviewer for consolidated fix.
Task5 server fix1 commitc773037f base592470e9,60tests/typecheck passed; independent scoped rereview2 addressed0 open, server slice gate complete.
Task6 harness openknowledge_source rebuilding/restarting isolated local environment with reviewed server; old pid16406 gracefully stop+schema cleanup required.

Task3 review1 one Important slash viewport clipping. Original implementer manual_document_canvas fixround1 measured flip/clamp+scroll/resize regression underway.
Task6 environment restarted on reviewed c773037f server. Old16406 stopped, schema removed verified; new parent34134 web59105 page41c40a23-499f-44bc-9c76-60e52a66dec2 Spacecmuvt41cb001g67i3o38rg8b4.153server tests pass1Windows skip8suites.
Task5 ReviewPage baseline ruling: when current.updatedAt matches proposal.expectedUpdatedAt, label Current document matches proposal base version; otherwise current-vs-candidate + stale/unavailable warning. Do not invent historical baseline or new API.

Task3 fix1 commit4dd0294a independent rereviewApproved; Task 3: complete (8ddaf98a..4dd0294a, focused265+83tests). Controller browser bottom slash desktop rect420..693 within720,390px viewport rect555..828within844/right236within390. Task4 editor gate released recoverable_drafts.
Task3 followup browser bug at1680width: auto wide outline fixedtop140 overlays page toolbar162..222 hiding AskAgent. Original implementer narrow ArticleContentsPopover/CSS repair dispatched; Task4 PageEditor remains exclusive.
Task5 client phase1 commitac3a7734,52focused/tsc/lint; independentreview foundmalformed original noteoffset normalization, fix1commit5c2a4564,27focused/tsc/lint. Scoped rereview underway. Shared editor integration remains pendingTask4gate.

Task3 wide outline followup3873c954 (base5c2a4564),12tests+tsc, independent focusedreviewApproved.
Task5 phase1 fix5c2a4564 independentrereviewApproved. Phase2A panel/candidates only started originalscoped_assist_client; PageEditor integration blocked onlyTask4 ownership/review.
Task4 firstintegrated120tests+tscpass. Controlleractualbrowser recoverynoticebuttons coveredbynegativeoffset Markdown toolbar: 恢复 rectx367,y295.5,w84,h20 hit-testcenter lands斜体. screenshotdraft-toolbar-overlap.jpg;repairbeforefreeze requested. Clipboard source '**' interim invalid recovery due buttonhit, do not claim restorepass.

Task4 commit53e5c574 base3873c954,129focused+lint. Independentreview_local_drafts2findings:P1discardoldoffer differentbranch callsload,cancelsnewpendinghumanwrite;P2normalrefreshregressesknownsocketrevisionafterdismissopeningstalerestore. Fixround1originalrecoverable_draftsdispatched.
Task5 Phase2A commit0a606ded base53e5c574,118focused/tsc/lint. SharedPageEditorintegrationstillgated; originalagentcontinuesnewscopednotes hook/tests only duringTask4repairs. CombinedTask5reviewafterfinalintegration.
ControllerTask4 browser: frozen53e5c574correctrecoverycenterhit+explicitrestore→SaveAPI success. ActualremoteAPI versionadvance thennewtabshows stale localdraftpreview/export/discardonly,noRestore; servercontentpreserved.

Task4 fix1commitb89a3f84 base0a606ded;132tests+lint, scoped rereview requested. Preserve unresolvedSocketRevisionRef/reset rules in downstreamTask5.
Task6 fullserver harness exited0:COLLABORATION_TEST_DATABASE_URL loopbacktest target + PG_DUMP_BIN16.14;161suitespass/1skipped,2838testspass/4skipped,46.441s. Reviewedserverc773037f unchanged. Random collaboration_test schemahelper completedcleanup. /tmp/document-workspace-server-full.log;expectednegativeHTTPauth/versiontestlogspresent,not runtimebrowsererrors.

Task4 fixround1/5closed2open0independentrereviewApprovedb89a3f84. Task 4: complete (3873c954..b89a3f84, excludingseparatelycommittedTask5panel0a606ded).
Task5finalPageEditorownershipRELEASED toscoped_assist_client:wireup existingselectors/notes/controller/candidateapplypreservingTask4invariants. Fullclientandwholebranchgatepending.

Task5phase2ApanelreviewApproved0Critical0Important1Minor(redundantcanAcceptCandidatecomputesapplytwice);passedtosameimplementerforintegrationcleanup.
RuntimeharnessfirstattemptfailedclosedmissingexplicitDBtargets:28pass10fail95skip databasephase(noenv). openknowledge_sourcevalidatesprerequisitesandrunsisolation-safeenv; notcode-regressionclaim.

Task5 final Phase2B commit dfd4bbba: 354 focused tests/17 files, tsc/scopedlint pass. Independent integration review found two P2s: drawer close loses candidate/attempt state and can auto-submit same request again; line-level hunk overlap resolves unchanged same-line notes. Original scoped_assist_client fix round1 active; browser stateful flow paused during HMR writes.
Full client gate on dfd4bbba: 131 files/1833 tests passed. Whole repo typecheck passed. Lint found five new errors; mechanical fix eb83dd83 passed lint but build caught ES ErrorOptions target incompatibility. final_lint_repairs owns minimal compatible repair and tsc verification.
Runtime safe phases reconciled422pass53skip; tempdir accounting collisions fixed only by isolated TMPDIR rerun, public/schema/database inventories unchanged. Additional owned whole-DB-only setup authorized to close52legacy gates if no cluster-global changes needed.
Browser scoped AskAgent actualPOST exacttarget, simulatedcompletionnoautowrite, accept preserves separatelyappendedhumantext, oneundo restores exactbaseplushumantext=true. NativeAX selection includedleadingnewlines; fixture result visibly preserved requestedoutsidebytes. Private notes two quotedanchors persisted acrossHMR; finalbatchaccept stillpending.

Task5 fixround1 commit0e47dfdc: drawer continuity closed; remainingnotesmulti-hunkuncertain omission keptP2 open. Fixround2 commit2cf55ee9,365focused/tsc/lint, scopedrereviewApprovedclosed1open0. Task 5: complete (server8ddaf98a/c773037f,clientac3a7734..2cf55ee9 excludingotherTaskcommits, allindependentgatesclean).
Build followup: eb83dd83 ErrorOptions incompatibleclientlib repairedb68690bcObject.assigncause,40tests/tsc/lint; review_assist_panel independentlyconfirmedmechanicalfixes. Productionbuild revealedPageEditor518706>500000; bundle_budget_repair extends sharededitor-core runtimesonly in897aa3f8, finalbranchreview tocover. Completeclientbuildpass,PageEditor423120/editor-core336673/initial547266withinunchangedbudgets;6budgettests/tsc/lintpass.
Finalclientfull131files1844tests pass on897aa3f8. Fullrepo type/lint/build following. Protocol10files140pass;localsync67files942pass1skip. Runtime withownedwholeDBs479pass1externalCodeGraphskip; oneHTTPtestusesexplicitredishardcodeportonlyloaderadaptation, nooriginalzero-skipclaim. AllownedDBs/Rediscleaned,34134alive.
Browser finalTask5: realnotes2batchPOST, fixturemulti stream/done leavesbothawaitingreview; accept1 resolvesonlynote1; closeEnterhidden:true/display:none and reopen retainsfirstdisabled/secondactive; accept2 resolvesnote2; oneundo preserveschange1/removeschange2. Snapshotrepeatednativeclicktoolmisseswerenotproductbugs;keyboardactivationverified.

Final whole-branch review on897aa3f8: ReadytoMergeYes,0Critical0Important0Minor, alltaskreviewsclosed. Finalfullclient1844;whole type/lint0errors/buildpassed; builtpreview59108coldUI loadedPageEditor/editor-coreHTTP200,manualundoexact,390notesdrawercontained/nooverflow/consoleclean. Realremoteversionconflictfromotherlocaltabblockedcandidateacceptwithunchangedwhole source.
Task 6: complete (fidelityprobe+fullchecks+independentwholebranchreview+realbrowser, noexternalprovider/nativeIME/Windowsstressclaim). Deliverydocumentation and temporaryservicecleanup following;productSHA897aa3f8.

Delivery: finalproduct897aa3f8+documentationonlycommit;6acceptancetabsclosed,viewportreset,preview59108stopped,harness34134andchildren34181/34186/34190absent,schemaCleanedtrue+SQL0. Ownedruntime4DBsandRedisremoved. Durableacceptance/reviews/screenshots/ledger preserved underdocs/verification/document-workspace-20261006. No merge/push/deploy. Keepattachedworktree forintegration.
