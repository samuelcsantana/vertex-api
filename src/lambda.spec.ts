// One assertion, about ordering rather than behaviour, and it exists because
// the deployed function failed on exactly this.
//
// The handler loads its configuration from Parameter Store before building
// the app. That is worthless if the application module has already been
// evaluated — a static `import { AppModule }` runs when this file is loaded,
// before any function in it, and AuthModule throws at import time when
// JWT_SECRET is missing. The first deploy died that way: parameters read
// correctly, into a process that had already decided it had none.
//
// So: loading the entry point with an empty environment must not throw.
describe('lambda entry point', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  it('does not evaluate the application module when it is loaded', () => {
    delete process.env.JWT_SECRET;
    delete process.env.COOKIE_SECRET;
    delete process.env.DATABASE_URL;

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./lambda');
      });
    }).not.toThrow();
  });
});
