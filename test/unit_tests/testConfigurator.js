const NightwatchConfigurator = require('../../lib/NightwatchConfigurator').default;
const assert = require('assert');

describe('Configurator tests', function() {
  it('Test hasSupportedFlags', () => {
    let hasSupported = NightwatchConfigurator.hasSupportedFlags({add: 'component-testing'});

    assert.ok(hasSupported);

    hasSupported = NightwatchConfigurator.hasSupportedFlags({
      install: 'vrt',
      add: 'mobile'
    });

    assert.ok(hasSupported);

    hasSupported = NightwatchConfigurator.hasSupportedFlags({
      install: 'vrt'
    });

    assert.ok(!hasSupported);
  });
});