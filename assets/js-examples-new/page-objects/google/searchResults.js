/**
 * A Nightwatch page object. The page object name is the filename.
 *
 * Usage:
 *   browser.page.google.searchResults()
 * 
 * See the example test using this object:
 *   specs/with-page-objects/google.js
 *
 * For more information on working with page objects, see:
 *   https://nightwatchjs.org/guide/concepts/page-object-model.html
 *
 */

const util = require('util');

// starting xpath with './/' tells browser to begin search from the current element,
// while starting with '//' tells browser to begin search from the start of html document.
const menuXpath = './/span[contains(text(), "%s")]';

const menuCommands = {
  productIsSelected: function(product, callback) {
    var self = this;

    return this.getAttribute(product, 'class', function(result) {
      let isSelected = result.value.indexOf('hdtb-msel') > -1;
      callback.call(self, isSelected);
    });
  }
};

module.exports = {
  elements: {
    results: {selector: '#rso'}
  },

  sections: {
    menu: {
      selector: 'div[role="navigation"] div[data-st-cnt="mode"]',
      commands: [menuCommands],
      elements: {
        maps: {
          selector: util.format(menuXpath, 'Maps'),
          locateStrategy: 'xpath',
          index: 0
        },
        videos: {
          selector: util.format(menuXpath, 'Videos'),
          locateStrategy: 'xpath',
          index: 0
        },
        images: {
          selector: util.format(menuXpath, 'Images'),
          locateStrategy: 'xpath',
          index: 0
        },
        news: {
          selector: util.format(menuXpath, 'News'),
          locateStrategy: 'xpath',
          index: 0
        }
      }
    }
  }
};