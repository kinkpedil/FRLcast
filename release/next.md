<!--
  Highlights for the NEXT release, in both languages: a few short lines a league organiser
  cares about, not a commit list (the script adds that). publish-desktop.ps1 puts them at the
  top of the release notes, the in-app update banner and the /changelog page, then empties
  this file in the release commit. Leave both sections empty for a small fix.
-->
## en

- Fixed a sync failure on hosted events: a penalty left over from a driver who is no longer on the grid was rejected by the database and blocked every update, so messages, flags and timing could stop reaching the online event. Those stray penalties are now skipped and the event syncs again.

## id

- Perbaikan kegagalan sinkron di event hosted: penalti sisa dari driver yang sudah tidak ada di grid ditolak database dan memblokir semua update, sehingga pesan, flag, dan timing bisa berhenti sampai ke event online. Penalti sisa itu kini dilewati dan event sinkron lagi.
