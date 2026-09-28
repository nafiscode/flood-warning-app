"""Cloudflare R2 helper for pipeline outputs.

  check                                   list both buckets and their object counts (tests the keys)
  push FILE --bucket public|private --key KEY [--dry-run]
                                          upload one file; refuses to overwrite an existing key
  ls [--bucket public|private] [--prefix P]
                                          list objects
  manifest LAYER KEY [--dry-run]          point jaga-tiles/manifest.json's LAYER at KEY (public bucket)
  manifest --show                         print the current manifest

Settings come from the environment or .env.local (R2_*; see .env.example). Nothing here prints key values.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import R2Config, R2Error, list_keys, make_client, push, read_manifest, set_layer


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="r2sync", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    p = sub.add_parser("push")
    p.add_argument("file", type=Path)
    p.add_argument("--bucket", choices=["public", "private"], required=True)
    p.add_argument("--key", required=True)
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("ls")
    p.add_argument("--bucket", choices=["public", "private"], default="public")
    p.add_argument("--prefix", default="")
    p = sub.add_parser("manifest")
    p.add_argument("layer", nargs="?")
    p.add_argument("key", nargs="?")
    p.add_argument("--show", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    try:
        cfg = R2Config.from_env()
        client = make_client(cfg)
        if args.command == "check":
            for which, name in cfg.buckets.items():
                n = len(list_keys(client, name))
                print(f"{which:7} {name}: reachable, {n} objects")
        elif args.command == "push":
            print(push(client, cfg, args.file, args.bucket, args.key, args.dry_run))
        elif args.command == "ls":
            for key, size in list_keys(client, cfg.buckets[args.bucket], args.prefix):
                print(f"{size / 1e6:10.1f} MB  {key}")
        elif args.command == "manifest":
            if args.show or not args.layer:
                print(json.dumps(read_manifest(client, cfg), indent=2, sort_keys=True))
            elif not args.key:
                ap.error("manifest needs LAYER and KEY (or --show)")
            else:
                m = set_layer(client, cfg, args.layer, args.key, args.dry_run)
                print(("dry run, would set " if args.dry_run else "set ") + f"{args.layer} -> {m['layers'][args.layer]['key']}")
    except R2Error as e:
        print(f"r2sync: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # botocore errors: show the type and code, not request details
        code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        print(f"r2sync: {type(e).__name__} {code}".rstrip() + ". Check the R2_* values in .env.local "
              "and that the token covers both buckets.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
