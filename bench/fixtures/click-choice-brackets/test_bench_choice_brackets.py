# Hidden test for bench task click-choice-brackets.
# From pallets/click 762c97e (tests/test_basic.py), BSD-3-Clause License.
import click


def test_choice_argument_optional_metavar(runner):
    @click.command()
    @click.argument("method", type=click.Choice(["foo", "bar", "baz"]), nargs=-1)
    def cli_variadic(method):
        pass

    @click.command()
    @click.argument("method", type=click.Choice(["foo", "bar", "baz"]), required=False)
    def cli_optional(method):
        pass

    variadic = runner.invoke(cli_variadic, ["--help"]).output
    assert "Usage: cli-variadic [OPTIONS] [foo|bar|baz]...\n" in variadic
    assert "[[foo|bar|baz]]" not in variadic

    optional = runner.invoke(cli_optional, ["--help"]).output
    assert "Usage: cli-optional [OPTIONS] [foo|bar|baz]\n" in optional
    assert "[[foo|bar|baz]]" not in optional


def test_datetime_argument_optional_metavar(runner):
    @click.command()
    @click.argument("when", type=click.DateTime(formats=["%Y-%m-%d"]), required=False)
    def cli(when):
        pass

    result = runner.invoke(cli, ["--help"])
    assert "Usage: cli [OPTIONS] [%Y-%m-%d]\n" in result.output
    assert "[[%Y-%m-%d]]" not in result.output


def test_required_choice_argument_unchanged(runner):
    @click.command()
    @click.argument("method", type=click.Choice(["foo", "bar"]))
    def cli(method):
        pass

    result = runner.invoke(cli, ["--help"])
    assert "Usage: cli [OPTIONS] {foo|bar}\n" in result.output


def test_optional_plain_argument_still_bracketed(runner):
    @click.command()
    @click.argument("name", required=False)
    def cli(name):
        pass

    result = runner.invoke(cli, ["--help"])
    assert "Usage: cli [OPTIONS] [NAME]\n" in result.output
