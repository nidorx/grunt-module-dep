'use strict';

var path = require('path');
var glob = require('glob');
var chalk = require('chalk');



var HTML_PARSER = {
    block: /(([ \t]*)<!--\s*module:*(\S*)\((\S*)\)\s*-->)(\n|\r|.)*?(<!--\s*endModule\s*-->)/gi,
    detect: {
        js: /<script.*src=['"](.+)['"]>/gi,
        css: /<link.*href=['"](.+)['"]/gi
    },
    replace: {
        js: '<script src="{{filePath}}"></script>',
        css: '<link rel="stylesheet" href="{{filePath}}" />'
    }
};

var replaceHtmlContent = function (htmlContent, htmlFilePath) {

    var returnType = /\r\n/.test(htmlContent) ? '\r\n' : '\n';
    var filesCaught = [];
    var findReferences = function (match, reference) {
        filesCaught.push(reference);
        return match;
    };

    /**
     * Callback function after matching our regex from the source file.
     *
     * @param  {array}  match       strings that were matched
     * @param  {string} startBlock  the opening <!-- module:xxx(modToInject) --> comment
     * @param  {string} spacing     the type and size of indentation
     * @param  {string} injectType  the type of block (js/css)
     * @param  {string} module      O módulo a ser injetado
     * @param  {string} oldScripts  the old block of scripts we'll remove
     * @param  {string} endBlock    the closing <!-- endModule --> comment
     * @return {string} the new file contents
     */
    function replaceFn(
            match, startBlock, spacing, injectType, module, oldScripts, endBlock,
            offset, string
            ) {
        injectType = injectType || 'js';

        var newFileContents = startBlock;
        var dependencies = [];

        // verifica as referencias, para evitar duplicidade
        string = string.substr(0, offset) + string.substr(offset + match.length);
        string
                .replace(oldScripts, '')
                .replace(HTML_PARSER.detect[injectType], findReferences);

        spacing = returnType + spacing.replace(/\r|\n/g, '');

        // Obtém os arquivos a serem inseridos
        var dependencies = glob.sync(path.join(htmlFilePath, module, '/**/*.' + injectType));
        dependencies.map(function (depPath) {
            return path.join(
                    path.relative(path.dirname(htmlFilePath), path.dirname(depPath)),
                    path.basename(depPath)
                    ).replace(/\\/g, '/');
        }).filter(function (relativeDepPath) {
            return filesCaught.indexOf(relativeDepPath) === -1;
        }).forEach(function (filePath) {
            if (typeof HTML_PARSER.replace[injectType] === 'function') {
                newFileContents += spacing + HTML_PARSER.replace[injectType](filePath);
            } else if (typeof HTML_PARSER.replace[injectType] === 'string') {
                newFileContents += spacing + HTML_PARSER.replace[injectType].replace('{{filePath}}', filePath);
            }
        });

        return newFileContents + spacing + endBlock;
    }

    
    return htmlContent.replace(HTML_PARSER.block, replaceFn);
};

function moduleDepGrunt(grunt) {
    grunt.registerMultiTask('moduledep', 'Inject Bower packages into your source code.', function () {
        this.requiresConfig([
            'moduledep',
            this.target,
            'src'
        ]);

        var options = this.options(this.data);

        if (this.files.length < 1) {
            grunt.verbose.warn('Destination not written because no source files were provided.');
        }

        this.files.forEach(function (f) {
            var files = f.src.filter(function (filepath) {
                // Warn on and remove invalid source files (if nonull was set).
                if (!grunt.file.exists(filepath)) {
                    grunt.log.warn('Source file "' + filepath + '" not found.');
                    return false;
                }

                // permite apenas arquivos .html
                var ext = path.extname(filepath).substr(1);
                if (['html', 'htm'].indexOf(ext) < 0) {
                    return false;
                }

                return true;
            });

            if (files.length === 0) {
                if (f.src.length < 1) {
                    grunt.log.warn('Destination not written because no source files were found.');
                }
                return;
            }

            files.forEach(function (filepath) {
                try {
                    var htmlContent = String(grunt.file.read(filepath));
                    var newHtmlContent = replaceHtmlContent(htmlContent, filepath);

                    if (htmlContent !== newHtmlContent) {
                        grunt.file.write(f.dest, newHtmlContent);
                        grunt.verbose.writeln('File ' + chalk.cyan(f.dest) + ' modified.');
                    }
                } catch (e) {
                    grunt.log.error(e);
                    grunt.fail.warn('moduledep failed to parse "' + filepath + '".');
                    return false;
                }
            });
        });

        grunt.log.ok(this.files.length + ' ' + grunt.util.pluralize(this.files.length, 'file/files') + ' modified.');
    });
}

module.exports = moduleDepGrunt;
