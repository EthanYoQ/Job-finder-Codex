# Recovery boundaries

## Docker

Docker documents `save` as an archive of selected images and parent layers; `load` restores images and tags. Neither statement establishes that every original registry-digest association survives a save/remove/load cycle on a particular engine and storage driver.

The Moby project records a case where a saved image lost its `RepoDigests` after removal and load. Treat this as a known risk to verify, not a claim that every current Docker engine has the same behavior. Do not test removal on the production host merely to find out whether the risk applies.

If the old image has only a registry-digest reference, preserving an image-ID-to-digest mapping is useful evidence but does not recreate that digest association. Get a demonstrated recovery route for the required reference or explain the limitation and obtain specific approval. A registry pull is not a proven recovery route until access to the exact digest and artifact has been checked; remote availability can change.

Protect all container-referenced images, including images used by stopped containers. If a separately approved exact image removal is appropriate, avoid forced deletion and blanket prune operations. Docker's `--no-prune` option prevents incidental removal of untagged parent images; review support in the actual engine help before using it. This skill does not claim that any removal command has been executed or validated.

Official references checked on 2026-10-07:
- [docker image save](https://docs.docker.com/reference/cli/docker/image/save/)
- [docker image load](https://docs.docker.com/reference/cli/docker/image/load/)
- [docker image rm](https://docs.docker.com/reference/cli/docker/image/rm/)
- [Moby issue: digest is lost after loading a saved image](https://github.com/moby/moby/issues/22011)

## Archive versus expanded tree

An old recovery directory may contain one already-compressed archive and a few verification records. The directory's full allocation is then the retained recovery package itself. It is not a duplicate expanded tree and should not be removed on that assumption.

A checksummed archive is not automatically a demonstrated restoration. When cleanup is authorized, verify the selected tree's contents and required file metadata against an isolated restore in the same approved environment. Do not create or delete recovery material outside the user's environment boundary to make the check easier.
