const path = require('path')
// webpack 打包的是 v2.0.0 版本
const v2 = {
  entry: {
    parchment: './src/parchment.ts',
  },
  output: {
    filename: '[name].js',
    library: {
      name: 'Parchment',
      type: 'umd',
    },
    path: __dirname + '/dist',
    // https://github.com/webpack/webpack/issues/6525
    globalObject: `(() => {
        if (typeof self !== 'undefined') {
            return self;
        } else if (typeof window !== 'undefined') {
            return window;
        } else if (typeof global !== 'undefined') {
            return global;
        } else {
            return Function('return this')();
        }
    })()`,
  },
  resolve: {
    extensions: ['.js', '.ts'],
  },
  module: {
    rules: [{ test: /\.ts$/, use: 'ts-loader' }],
  },
  devtool: 'source-map',
  // mode: 'development',
};

// v1.1.1
// webpack 3.0
const v1 = {
  entry: ['./parchment/src/parchment.ts'],
  output: {
    filename: 'parchment.js',
    library: 'Parchment',
    libraryTarget: 'umd',
    path: __dirname + '/parchment/dist',
  },
  
  resolve: {
    extensions: ['.js', '.ts'],
  },
  module: {
    rules: [{ 
      test: /\.ts$/, 
      use: 'ts-loader',
      include: /src/,
    },
    {
      test: /\.js$/,
      include: /src/,
    }],
  },
  devtool: 'source-map',
};


module.exports = v1