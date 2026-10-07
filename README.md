# Aliyun safe cleanup skill: resource-window update

This snapshot preserves eight original skill files and their delivery manifest. Restore the complete skills/aliyun-safe-cleanup directory. The manifest is colocated with SKILL.md so its relative file paths resolve; its source originally lived one directory above the skill. All original contents are unchanged.

This revision updates SKILL.md and adds references/resource-window.md. Six existing helper, test and reference files are byte-identical to [the previous cleanup skill](https://github.com/EthanYoQ/Job-finder-Codex/tree/e0ab678cd139b2a04277bf0d0f9cc99a0b7f8f30). Source hashes are recorded in SOURCE_BACKUP.json and the original delivery manifest.

The manifest records a resource-guard deferral: zero deletions and zero actively freed bytes. The original files were retained; no successful archive, import, removal or cleanup is claimed. The backup does not change that outcome or grant permission to execute cleanup procedures.

Markdown/YAML require no runtime installation to restore. Optional helper use requires the documented Linux/POSIX/Python standard-library environment and applicable system tools; scripts are preserved with mode 100644. The archive checker is limited to its documented classic Docker-save format and is not proof of docker load or complete recovery. Actual host results, image contents/IDs, credentials, operational receipts and unexecuted export/load drafts are excluded.

Backup validation checked exact hashes, unchanged-source equality, static content and local links. It did not run the skill, helper tests, inventory, archive or cleanup commands. The delivery manifest's test counts are preserved as source-provided validation records.
