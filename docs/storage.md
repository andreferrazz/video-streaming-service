# Storage

Videos, renditions and posters live in one bucket of S3-compatible object
storage. The stack ships with [Garage](https://garagehq.deuxfleurs.fr/), but
nothing in the apps depends on Garage: any server that speaks the S3 protocol
can take its place by changing settings.

## How the apps use storage

All storage access goes through one file, `shared/src/storage.ts`. The web app
and the worker call its functions and never touch the S3 library themselves.

| Function | Used for | S3 operations |
|---|---|---|
| `uploadStream` | storing an upload as it arrives | multipart upload |
| `uploadFile` | storing a segment, playlist or poster | `PutObject` |
| `downloadToFile` | fetching an original to transcode | `GetObject` |
| `openObject` | streaming a file to a player | `GetObject` |
| `objectExists` | checking whether a poster has been made | `HeadObject` |
| `deleteVideoFiles` | removing everything a video owns | `ListObjectsV2`, `DeleteObject` |

That is the whole contract. The apps do not use presigned URLs, access control
lists, versioning, lifecycle rules, bucket notifications or any provider's own
extensions.

The file layout is in the [README](../README.md#files-in-the-bucket).

## Checking a provider

One command runs every function above against a real server:

```bash
pnpm --filter shared storage:check
```

It reads the same `S3_*` settings the apps use. It works on a made-up video id,
so it is safe against a bucket that is in use, and it removes what it wrote. It
uploads 40 MB in parts, compares downloads byte for byte, and stores 1,100 files
under one video so that listing has to span more than one page.

CI runs this check on every pull request against two unrelated servers: Garage,
and [Versity Gateway](https://github.com/versity/versitygw). Passing on both is
what backs the claim that storage is replaceable.

The whole stack has also been run once against Versity Gateway with Garage
switched off: upload, transcode, playback and delete.

## Using a different provider

The bucket and its access key have to exist at the provider already.

### On the deployed stack

Set these in the Compose service's environment and deploy:

| Variable | Value |
|---|---|
| `EXTERNAL_S3_ENDPOINT` | the provider's S3 address, for example `https://s3.eu-west-1.amazonaws.com` |
| `EXTERNAL_S3_REGION` | the region name the provider expects |
| `EXTERNAL_S3_BUCKET` | the bucket's name |
| `EXTERNAL_S3_FORCE_PATH_STYLE` | `false` if the provider wants `bucket.host` addressing; leave unset otherwise |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the key pair for that bucket |
| `GARAGE_REPLICAS` | `0`, so the bundled Garage is not started |

With `EXTERNAL_S3_ENDPOINT` set, the `garage-init` job exits without doing
anything, and the `GARAGE_*` secrets are no longer needed.

These are separate from the `S3_ENDPOINT`, `S3_REGION` and `S3_BUCKET` variables
on purpose. A local `.env` sets those to `localhost` addresses for apps running on
your machine, which would be wrong inside the containers.

### Locally

Change `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, the two keys and, if needed,
`S3_FORCE_PATH_STYLE` in `.env`, then run the check above.

### Moving existing videos

Changing the settings does not move any files. Copy the bucket's contents to the
new provider first, with a tool such as `rclone`, keeping the same key names. The
database needs no change, because file locations are derived from each video's
id and are not stored.

## What is specific to Garage

Three things, none of them in the apps:

- **The `garage` service and `garage/garage.toml`**: the server itself.
- **The `garage-init` job**: it gives the node its storage role, creates the
  bucket and registers the access key through Garage's admin API. Other providers
  have their own ways of creating a bucket and a key.
- **The size cap.** `garage-init` sets a quota on the bucket, and the apps
  recognise Garage's error when it is reached. Most other providers have no such
  quota, so the cap would not apply there.

## Settings

| Variable | Meaning |
|---|---|
| `S3_ENDPOINT` | address of the S3 server |
| `S3_REGION` | region name; Garage uses `garage` |
| `S3_BUCKET` | bucket name |
| `S3_FORCE_PATH_STYLE` | `true` (default) for `host/bucket` addressing, `false` for `bucket.host` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the key pair |
