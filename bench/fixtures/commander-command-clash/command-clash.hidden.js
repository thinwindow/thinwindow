// Hidden test for bench task commander-command-clash.
// From tj/commander.js 1d3dd47 (tests/command.registerClash.test.js), MIT License.
const { Command } = require('../');

test('when command name conflicts with existing name then throw', () => {
  expect(() => {
    const program = new Command();
    program.command('one');
    program.command('one');
  }).toThrow('cannot add command');
});

test('when command name conflicts with existing alias then throw', () => {
  expect(() => {
    const program = new Command();
    program.command('one').alias('1');
    program.command('1');
  }).toThrow('cannot add command');
});

test('when command alias conflicts with existing name then throw', () => {
  expect(() => {
    const program = new Command();
    program.command('one');
    program.command('1').alias('one');
  }).toThrow('cannot add alias');
});

test('when command alias conflicts with existing alias then throw', () => {
  expect(() => {
    const program = new Command();
    program.command('one').alias('1');
    program.command('unity').alias('1');
  }).toThrow('cannot add alias');
});

test('when .addCommand name conflicts with existing name then throw', () => {
  expect(() => {
    const program = new Command();
    program.command('one');
    program.addCommand(new Command('one'));
  }).toThrow('cannot add command');
});

test('when .addCommand alias conflicts with existing name then throw', () => {
  expect(() => {
    const program = new Command();
    program.command('one');
    program.addCommand(new Command('unity').alias('one'));
  }).toThrow('cannot add command');
});

test('when names and aliases are distinct then no throw', () => {
  expect(() => {
    const program = new Command();
    program.command('one').alias('1');
    program.command('two').alias('2');
    program.addCommand(new Command('three').alias('3'));
  }).not.toThrow();
});
