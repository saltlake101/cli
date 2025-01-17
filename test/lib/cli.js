const t = require('tap')

const { load: loadMockNpm } = require('../fixtures/mock-npm.js')

const cliMock = async (t, opts) => {
  let exitHandlerArgs = null
  let npm = null
  const exitHandlerMock = (...args) => {
    exitHandlerArgs = args
    npm.unload()
  }
  exitHandlerMock.setNpm = _npm => npm = _npm

  const { Npm, outputs, logMocks, logs } = await loadMockNpm(t, { ...opts, init: false })
  const cli = t.mock('../../lib/cli.js', {
    '../../lib/npm.js': Npm,
    '../../lib/utils/unsupported.js': {
      checkForBrokenNode: () => {},
      checkForUnsupportedNode: () => {},
    },
    '../../lib/utils/exit-handler.js': exitHandlerMock,
    ...logMocks,
  })

  return {
    Npm,
    cli,
    outputs,
    exitHandlerCalled: () => exitHandlerArgs,
    exitHandlerNpm: () => npm,
    logs,
    logsBy: (title) => logs.verbose.filter(([p]) => p === title).map(([p, ...rest]) => rest),
  }
}

t.afterEach(() => {
  delete process.exitCode
})

t.test('print the version, and treat npm_g as npm -g', async t => {
  const { logsBy, logs, cli, Npm, outputs, exitHandlerCalled } = await cliMock(t, {
    globals: { 'process.argv': ['node', 'npm_g', '-v'] },
  })
  await cli(process)

  t.strictSame(process.argv, ['node', 'npm', '-g', '-v'], 'system process.argv was rewritten')
  t.strictSame(logsBy('cli'), [['node npm']])
  t.strictSame(logsBy('title'), [['npm']])
  t.strictSame(logsBy('argv'), [['"--global" "--version"']])
  t.strictSame(logs.info, [
    ['using', 'npm@%s', Npm.version],
    ['using', 'node@%s', process.version],
  ])
  t.strictSame(outputs, [[Npm.version]])
  t.strictSame(exitHandlerCalled(), [])
})

t.test('calling with --versions calls npm version with no args', async t => {
  const { logsBy, cli, outputs, exitHandlerCalled } = await cliMock(t, {
    mocks: {
      '../../lib/commands/version.js': class Version {
        async exec (args) {
          t.strictSame(args, [])
        }
      },
    },
    globals: {
      'process.argv': ['node', 'npm', 'install', 'or', 'whatever', '--versions'],
    },
  })
  await cli(process)

  t.equal(process.title, 'npm install or whatever')
  t.strictSame(logsBy('cli'), [['node npm']])
  t.strictSame(logsBy('title'), [['npm install or whatever']])
  t.strictSame(logsBy('argv'), [['"install" "or" "whatever" "--versions"']])
  t.strictSame(outputs, [])
  t.strictSame(exitHandlerCalled(), [])
})

t.test('logged argv is sanitized', async t => {
  const { logsBy, cli } = await cliMock(t, {
    mocks: {
      '../../lib/commands/version.js': class Version {
        async exec () {}
      },
    },
    globals: {
      'process.argv': [
        'node',
        'npm',
        'version',
        '--registry',
        'https://u:password@npmjs.org/password',
      ],
    },
  })

  await cli(process)
  t.equal(process.title, 'npm version')
  t.strictSame(logsBy('cli'), [['node npm']])
  t.strictSame(logsBy('title'), [['npm version']])
  t.strictSame(logsBy('argv'), [['"version" "--registry" "https://u:***@npmjs.org/password"']])
})

t.test('logged argv is sanitized with equals', async t => {
  const { logsBy, cli } = await cliMock(t, {
    mocks: {
      '../../lib/commands/version.js': class Version {
        async exec () {}
      },
    },
    globals: {
      'process.argv': [
        'node',
        'npm',
        'version',
        '--registry=https://u:password@npmjs.org',
      ],
    },
  })
  await cli(process)

  t.strictSame(logsBy('argv'), [['"version" "--registry" "https://u:***@npmjs.org"']])
})

t.test('print usage if no params provided', async t => {
  const { cli, outputs, exitHandlerCalled, exitHandlerNpm } = await cliMock(t, {
    globals: {
      'process.argv': ['node', 'npm'],
    },
  })
  await cli(process)

  t.match(outputs[0][0], 'Usage:', 'outputs npm usage')
  t.match(exitHandlerCalled(), [], 'should call exitHandler with no args')
  t.ok(exitHandlerNpm(), 'exitHandler npm is set')
  t.match(process.exitCode, 1)
})

t.test('print usage if non-command param provided', async t => {
  const { cli, outputs, exitHandlerCalled, exitHandlerNpm } = await cliMock(t, {
    globals: {
      'process.argv': ['node', 'npm', 'tset'],
    },
  })
  await cli(process)

  t.match(outputs[0][0], 'Unknown command: "tset"')
  t.match(outputs[0][0], 'Did you mean this?')
  t.match(exitHandlerCalled(), [], 'should call exitHandler with no args')
  t.ok(exitHandlerNpm(), 'exitHandler npm is set')
  t.match(process.exitCode, 1)
})

t.test('load error calls error handler', async t => {
  const err = new Error('test load error')
  const { cli, exitHandlerCalled } = await cliMock(t, {
    mocks: {
      '../../lib/utils/config/index.js': {
        definitions: null,
        flatten: null,
        shorthands: null,
      },
      '@npmcli/config': class BadConfig {
        async load () {
          throw err
        }
      },
    },
    globals: {
      'process.argv': ['node', 'npm', 'asdf'],
    },
  })
  await cli(process)
  t.strictSame(exitHandlerCalled(), [err])
})
