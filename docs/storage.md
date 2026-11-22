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
| `uploadFile` | storing a segment, playlist or poster | `PutObject` |
| `downloadToFile` | fetching an original to transcode | `GetObject` |
| `openObject` | streaming a file to a player | `GetObject` |
| `objectExists` | checking whether a poster has been made | `HeadObject` |
| `deleteVideoFiles` | removing everything a video owns | `ListObjectsV2`, `DeleteObject` |
| `measureVideoBytes` | counting what a video holds | `HeadObject`, `ListObjectsV2` |
| `startMultipartUpload` | opening a direct upload | `CreateMultipartUpload` |
| `signPartUpload` | giving a browser an address for one part | a presigned `UploadPart` |
| `listUploadedParts` | resuming, and finishing without trusting the browser | `ListParts` |
| `completeMultipartUpload` | assembling the parts | `CompleteMultipartUpload` |
| `abortMultipartUpload` | giving up on an upload | `AbortMultipartUpload` |
| `allowBrowserUploads`, `getBrowserUploadOrigins`, `forbidBrowserUploads` | letting the site's pages upload | `PutBucketCors`, `GetBucketCors`, `DeleteBucketCors` |

That is the whole contract. The apps do not use access control lists,
versioning, lifecycle rules, bucket notifications or any provider's own
extensions.

The direct-upload functions in the lower half are used by the upload endpoints
under `/admin/uploads`, which the upload page drives. See
[Direct uploads](#direct-uploads) below.

One client setting matters for any provider: checksums are only added where S3
requires them. By default the S3 library signs a checksum into every upload
address, which a browser sending a part cannot supply, and the upload is refused
with "Invalid digest".

The file layout is in the [README](../README.md#files-in-the-bucket).

## Direct uploads

A video is uploaded by the browser straight to storage, in parts. The web app
coordinates but no file data passes through it.

1. **Start.** The browser sends the title, size and type. The app reserves room,
   opens a multipart upload and answers with the part size and count.
2. **Send.** The browser asks for signed addresses a few at a time and sends four
   parts at once. A failed part is retried with growing pauses; an expired
   address is replaced.
3. **Finish.** The browser says it is done. The app asks storage which parts it
   holds and assembles the file only if every part is present at exactly the
   right size. If not, it names the parts still needed and the browser sends them.
4. **Resume.** The browser remembers the upload by the file's name, size and
   date. Choosing the same file again, even after a reload, continues from the
   parts already stored.
5. **Abandon.** The worker discards uploads with no activity for
   `UPLOAD_EXPIRY_HOURS` and releases their room.

Two things this needs from storage, beyond the operations above:

- **Browsers must be able to reach it.** Signed addresses are made for
  `S3_PUBLIC_ENDPOINT`, or for `S3_ENDPOINT` when that is not set. Locally the
  browser reaches Garage on `localhost:3900` directly. On the deployed stack the
  apps reach Garage by an internal name, so the `garage` service is given its own
  hostname in Dokploy (port 3900) and that address is set as
  `STORAGE_PUBLIC_URL`. With external storage the provider's address is already
  public and is used as is.
- **It must allow the site's pages to upload.** The web app sets the bucket's
  cross-origin rules at startup, for the origin in `ORIGIN`. Locally that defaults
  to `http://localhost:5173`; if the dev server runs on another port, set `ORIGIN`
  to match or uploads are blocked by the browser.

The bucket stays private. A signed address permits sending one part of one
upload, for an hour.

## Checking a provider

One command runs every function above against a real server:

```bash
pnpm --filter shared storage:check
```

It reads the same `S3_*` settings the apps use. It works on a made-up video id,
so it is safe against a bucket that is in use, and it removes what it wrote. It
uploads 40 MB in parts, compares downloads byte for byte, sends parts to signed
addresses the way a browser would, sets and restores the cross-origin rules, and
stores 1,100 files under one video so that listing has to span more than one
page.

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

`STORAGE_PUBLIC_URL` can then be left unset: browsers upload to
`EXTERNAL_S3_ENDPOINT` itself. The provider must allow cross-origin rules to be
set on the bucket; the web app sets them at startup.

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

Two things, neither of them in the apps:

- **The `garage` service and `garage/garage.toml`**: the server itself.
- **The `garage-init` job**: it gives the node its storage role, creates the
  bucket and registers the access key through Garage's admin API. Other providers
  have their own ways of creating a bucket and a key.

`garage-init` also sets a quota on the bucket, slightly above the storage limit
described next. That is only a backstop for this one server's shared disk; the
limit itself does not depend on it.

## The storage limit

The apps keep their own count of what is stored and enforce the limit
themselves, so it works the same with any provider.

- **The count** is `videos.stored_bytes`: what each video holds in the bucket,
  original, renditions and posters together. The total in use is the sum over
  all videos, so deleting a video frees its space with no extra bookkeeping.
- **The limit** is `STORAGE_LIMIT_GB`, 10 by default.
- **Room is reserved before anything is written.** An upload must declare its
  size; the web app sets that much aside and refuses the upload, storing nothing,
  if it would not fit. The worker does the same for the renditions once it knows
  how large they are. The check and the reservation happen under one database
  lock, so two uploads arriving together cannot both take the last free space.
- **A failed or interrupted write gives its room back**, and the worker removes
  any renditions it had already stored, so the count stays equal to what is
  really in the bucket.
- **Videos stored before the count existed** are measured once by the worker at
  startup.
- **After a crash**, the worker removes what an interrupted video had half
  stored and counts it again from what is really there, before retrying it.

When the limit is reached, an upload is refused, or a transcode fails, with
"Storage is full". The admin page shows how much is in use.

The count is only as good as the code that maintains it. Files written to the
bucket by anything other than the apps are not counted.

## Settings

| Variable | Meaning |
|---|---|
| `S3_ENDPOINT` | address of the S3 server |
| `S3_REGION` | region name; Garage uses `garage` |
| `S3_BUCKET` | bucket name |
| `S3_FORCE_PATH_STYLE` | `true` (default) for `host/bucket` addressing, `false` for `bucket.host` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the key pair |
| `STORAGE_LIMIT_GB` | the most all videos together may hold; default 10 |
