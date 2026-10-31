Publish the reviewed Sesame 0.2.4 plugin source through R2 dev.6. The plan pins source b30a8045abcdd9585200585fb19b85f6616f28fc, reproducible archive and source-lock hashes, and publishing dev-to-main PR #85.

The exact selection remains nine core and 45 optional API 2 packages. Kurumi is excluded. Seven updated packages require host >=0.2.4; the other 47 retain their existing versions and exact bytes. Immutable packages are uploaded and verified before the catalog is promoted, with independent review evidence tied to the final publishing PR head.

Validation: source locks and inventory; independent archive reconstruction; 43 static plugin checks, affected plugin integration regressions, 23 application-release checks and 10 installer-upload checks.
