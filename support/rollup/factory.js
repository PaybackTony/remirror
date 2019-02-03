import babel from 'rollup-plugin-babel';
import builtins from 'rollup-plugin-node-builtins';
import commonjs from 'rollup-plugin-commonjs';
import globals from 'rollup-plugin-node-globals';
import json from 'rollup-plugin-json';
import replace from 'rollup-plugin-replace';
import resolve from 'rollup-plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import { startCase } from 'lodash';

/**
 * Return a Rollup configuration for a `pkg` with `env` and `target`.
 *
 * @param {Object} pkg
 * @param {String} env
 * @param {String} format
 * @return {Object}
 */

function configure(pkg, env, target) {
  const folderName = pkg.name.replace('@remirror/', '');
  const extensions = ['.mjs', '.json', '.ts', '.tsx', '.js'];

  const isProd = env === 'production';
  const isUmd = target === 'umd';
  const isModule = target === 'module';
  const input = `@remirror/${folderName}/src/index.ts`;
  const deps = []
    .concat(pkg.dependencies ? Object.keys(pkg.dependencies) : [])
    .concat(pkg.peerDependencies ? Object.keys(pkg.peerDependencies) : []);

  const plugins = [
    // Allow Rollup to resolve modules from `node_modules`, since it only
    // resolves local modules by default.
    resolve({
      browser: true,
      extensions,
    }),

    // Allow Rollup to resolve CommonJS modules, since it only resolves ES2015
    // modules by default.
    isUmd &&
      commonjs({
        exclude: [`@remirror/${folderName}/src/**`],
        // HACK: Sometimes the CommonJS plugin can't identify named exports, so
        // we have to manually specify named exports here for them to work.
        // https://github.com/rollup/rollup-plugin-commonjs#custom-named-exports
        namedExports: {
          'react-dom': ['findDOMNode'],
          'react-dom/server': ['renderToStaticMarkup'],
        },
        extensions,
      }),

    // Convert JSON imports to ES6 modules.
    json(),

    // Replace `process.env.NODE_ENV` with its value, which enables some modules
    // like React and Remirror to use their production variant.
    replace({
      'process.env.NODE_ENV': JSON.stringify(env),
    }),

    // Register Node.js builtins for browserify compatibility.
    builtins(),

    // Use Babel to transpile the result, limiting it to the source code.
    babel({
      include: [`@remirror/${folderName}/src/**`],
      extensions,
    }),

    // Register Node.js globals for browserify compatibility.
    globals(),

    // Only minify the output in production, since it is very slow. And only
    // for UMD builds, since modules will be bundled by the consumer.
    isUmd && isProd && terser(),
  ].filter(Boolean);

  if (isUmd) {
    return {
      plugins,
      input,
      output: {
        format: 'umd',
        file: `@remirror/${folderName}/${pkg.browser.replace('.js', isProd ? '.min.js' : '.js')}`,
        exports: 'named',
        name: startCase(pkg.name).replace(/ /g, ''),
        globals: pkg.umdGlobals,
      },
      external: Object.keys(pkg.umdGlobals || {}),
    };
  }

  if (isModule) {
    return {
      plugins,
      input,
      output: [
        {
          file: `@remirror/${folderName}/${pkg.module}`,
          format: 'es',
          sourcemap: true,
        },
        {
          file: `@remirror/${folderName}/lib/dist/${folderName}.js`,
          format: 'cjs',
          exports: 'named',
          sourcemap: true,
        },
      ],
      // We need to explicitly state which modules are external, meaning that
      // they are present at runtime. In the case of non-UMD configs, this means
      // all non-Remirror packages.
      external: id => {
        return !!deps.find(dep => dep === id || id.startsWith(`${dep}/`));
      },
    };
  }
}

/**
 * Return a Rollup configuration for a `pkg`.
 *
 * @return {Array}
 */

function factory(pkg) {
  const isProd = process.env.NODE_ENV === 'production';
  return [
    configure(pkg, 'development', 'module'),
    isProd && configure(pkg, 'development', 'umd'),
    isProd && configure(pkg, 'production', 'umd'),
  ].filter(Boolean);
}

/**
 * Export.
 *
 * @type {Function}
 */

export default factory;