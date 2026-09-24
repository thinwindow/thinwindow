// Hidden test for bench task commander-negate-default-order.
// From tj/commander.js 63eed4a (tests/options.bool.combo.test.js), MIT License.
const commander = require('../');

describe('only lone negative causes implicit default of true', () => {
  test('when lone negative then default value is true', () => {
    const program = new commander.Command();
    program.option('--no-pepper', 'remove pepper');
    program.parse([], { from: 'user' });
    expect(program.opts().pepper).toBe(true);
  });

  test('when boolean combo and negative first then no implicit default', () => {
    const program = new commander.Command();
    program
      .option('--no-pepper', 'remove pepper')
      .option('--pepper', 'pepper only');
    program.parse([], { from: 'user' });
    expect(program.opts().pepper).toBeUndefined();
  });

  test('when boolean combo and negative second then no implicit default', () => {
    const program = new commander.Command();
    program
      .option('--pepper', 'pepper only')
      .option('--no-pepper', 'remove pepper');
    program.parse([], { from: 'user' });
    expect(program.opts().pepper).toBeUndefined();
  });

  test('when boolean combo and negative second with explicit default then get explicit default', () => {
    const program = new commander.Command();
    program
      .option('--pepper', 'pepper only')
      .option('--no-pepper', 'remove pepper', 'plain');
    program.parse([], { from: 'user' });
    expect(program.opts().pepper).toBe('plain');
  });
});
