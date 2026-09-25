<!--
  Highlights for the NEXT release, in both languages: a few short lines a league organiser
  cares about, not a commit list (the script adds that). publish-desktop.ps1 puts them at the
  top of the release notes, the in-app update banner and the /changelog page, then empties
  this file in the release commit. Leave both sections empty for a small fix.
-->
## en

- **Fixed the online link error "duplicate key ... drivers_pkey".** Linking a second event (or creating a new one) failed because the same cars were already rows of the first event. Every event now gets its own car ids, and an event linked with the older version is cleaned up by itself: accepted drivers stay connected.

## id

- **Error link online "duplicate key ... drivers_pkey" sudah diperbaiki.** Menghubungkan event kedua (atau membuat event baru) gagal karena mobil yang sama sudah tercatat di event pertama. Sekarang setiap event punya ID mobil sendiri, dan event yang pernah dihubungkan dengan versi lama dirapikan otomatis: pembalap yang sudah diterima tetap tersambung.
