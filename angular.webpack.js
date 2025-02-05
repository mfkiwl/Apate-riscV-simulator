const arch = process.env.ARCH || process.arch;
const platform = process.env.PLATFORM || process.platform;
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (config, options) => {
  config.target = 'electron-renderer';
  if (options.customWebpackConfig.target) {
    config.target = options.customWebpackConfig.target;
  } else if (options.fileReplacements) {
    for (let fileReplacement of options.fileReplacements) {
      if (fileReplacement.replace !== 'main_renderer/environments/environment.ts') {
        continue;
      }

      let fileReplacementParts = fileReplacement['with'].split('.');
      if (['dev', 'prod', 'test', 'electron-renderer'].indexOf(fileReplacementParts[1]) < 0) {
        config.target = fileReplacementParts[1];
      }
      break;
    }
  }

  config.externals = {
    ...config.externals,
    electron: 'require(\'electron\')',
    buffer: 'require(\'buffer\')',
    child_process: 'require(\'child_process\')',
    worker_threads: 'require(\'worker_threads\')',
    crypto: 'require(\'crypto\')',
    dialog: 'require(\'dialog\')',
    events: 'require(\'events\')',
    fs: 'require(\'fs\')',
    http: 'require(\'http\')',
    https: 'require(\'https\')',
    assert: 'require(\'assert\')',
    dns: 'require(\'dns\')',
    net: 'require(\'net\')',
    os: 'require(\'os\')',
    path: 'require(\'path\')',
    querystring: 'require(\'querystring\')',
    readline: 'require(\'readline\')',
    repl: 'require(\'repl\')',
    stream: 'require(\'stream\')',
    string_decoder: 'require(\'string_decoder\')',
    url: 'require(\'url\')',
    util: 'require(\'util\')',
    zlib: 'require(\'zlib\')',
    'electron-is-dev': 'require(\'electron-is-dev\')'
  };

  config.module.rules = [
    ...config.module.rules,
    {
      test: /\.node$/,
      use: 'node-loader'
    }, {
      test: /\.vert$/i,
      use: 'raw-loader'
    }, {
      test: /\.frag$/i,
      use: 'raw-loader'
    }, {
      test: /\.txt$/i,
      use: 'raw-loader'
    }, {
      test: /\.svg$/i,
      use: 'raw-loader'
    }, {
      test: /\.ya?ml$/i,
      use: [{
        loader: 'js-yaml-loader',
        options: {
          safe: false
        }
      }]
    }
  ];

  config.plugins = [
    ...config.plugins /*,
    new BundleAnalyzerPlugin({
      generateStatsFile: true
    })*/
  ];

  // Could be fun
  /*config.optimization.minimizer.push(new TerserPlugin({
    terserOptions: {
      topLevel: true,
      ecma: 6
    }
  }))*/

  return config;
};
