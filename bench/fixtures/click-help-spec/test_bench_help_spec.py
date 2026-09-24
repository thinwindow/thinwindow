# Hidden test for bench task click-help-spec.
# From pallets/click 271effb (tests/test_options.py), BSD-3-Clause License.
import pytest

import click


@pytest.mark.parametrize(
    ("param_decls", "kwargs", "expected"),
    [
        (["-v", "--verbose"], {"is_flag": True}, "-v, --verbose"),
        (["--config"], {}, "--config TEXT"),
        (["--color/--no-color"], {}, "--color / --no-color"),
        (["/debug;/no-debug"], {}, "/debug; /no-debug"),
    ],
)
@pytest.mark.parametrize("hidden", [False, True])
def test_help_spec(param_decls, kwargs, hidden, expected):
    opt = click.Option(param_decls, hidden=hidden, **kwargs)
    ctx = click.Context(click.Command("cli"))
    assert opt.get_help_spec(ctx) == expected

    if hidden:
        assert opt.get_help_record(ctx) is None
    else:
        assert opt.get_help_record(ctx)[0] == expected
