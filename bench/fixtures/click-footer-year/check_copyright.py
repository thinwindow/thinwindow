"""Checker for bench task click-footer-year.

Loads docs/conf.py with the clock frozen in a future year and checks that
the Sphinx `copyright` value (rendered in the docs site footer) follows the
clock. Run from the repository root:

    python3 check_copyright.py docs/conf.py

Exit code 0 means the footer year updates automatically.
"""

import datetime as real_datetime
import pathlib
import subprocess
import sys
import time as real_time
import types


def freeze(year):
    """Makes datetime and time report a date in `year`."""
    fake_now = real_datetime.datetime(year, 6, 15, 12, 0, 0)

    class FakeDate(real_datetime.date):
        @classmethod
        def today(cls):
            return cls(year, 6, 15)

    class FakeDateTime(real_datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(year, 6, 15, 12, 0, 0, tzinfo=tz)

        @classmethod
        def today(cls):
            return cls(year, 6, 15, 12, 0, 0)

        @classmethod
        def utcnow(cls):
            return cls(year, 6, 15, 12, 0, 0)

    fake = types.ModuleType("datetime")
    fake.__dict__.update(real_datetime.__dict__)
    fake.date = FakeDate
    fake.datetime = FakeDateTime
    sys.modules["datetime"] = fake

    stamp = fake_now.replace(tzinfo=real_datetime.timezone.utc).timestamp()
    struct = real_time.gmtime(stamp)
    real_strftime = real_time.strftime
    real_time.time = lambda: stamp
    real_time.localtime = lambda secs=None: struct if secs is None else real_time.gmtime(secs)
    real_time.gmtime = (lambda g: (lambda secs=None: struct if secs is None else g(secs)))(real_time.gmtime)
    real_time.strftime = lambda fmt, t=None: real_strftime(fmt, struct if t is None else t)


def stub_theme():
    theme = types.ModuleType("pallets_sphinx_themes")
    theme.get_version = lambda name, *args, **kwargs: ("0.0.0", "0.0")

    class ProjectLink:
        def __init__(self, *args, **kwargs):
            self.args = args

    theme.ProjectLink = ProjectLink
    sys.modules["pallets_sphinx_themes"] = theme


def load_copyright(conf_path, year):
    freeze(year)
    stub_theme()
    conf = pathlib.Path(conf_path)
    namespace = {"__file__": str(conf.resolve()), "__name__": "conf"}
    sys.path.insert(0, str(conf.parent.resolve()))
    exec(compile(conf.read_text(encoding="utf-8"), str(conf), "exec"), namespace)
    return namespace.get("copyright")


def main():
    conf_path = sys.argv[1]
    if len(sys.argv) > 2:
        # Child process: print the copyright value for one frozen year.
        print(load_copyright(conf_path, int(sys.argv[2])))
        return 0
    ok = True
    for year in (2031, 2047):
        out = subprocess.run(
            [sys.executable, __file__, conf_path, str(year)],
            capture_output=True,
            text=True,
        )
        value = out.stdout.strip()
        if out.returncode != 0:
            print(f"conf.py failed to load with the clock in {year}:\n{out.stderr[-2000:]}")
            ok = False
        elif str(year) not in value or "Pallets" not in value:
            print(f"with the clock in {year}, copyright is {value!r}: expected it to contain {year} and Pallets")
            ok = False
        else:
            print(f"{year}: {value!r} ok")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
