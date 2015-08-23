'use strict';

var _ = require('lodash');
var path = require('path');
var glob = require('glob');
var chalk = require('chalk');


// registra os módulos carregados
// usado para permitir atualizar o bower.json
var MODULES_LOADED = [];

var PATTERN = /(([ \t]*)<!--\s*module:*(\S*)\((\S*)\)\s*-->)(\n|\r|.)*?(<!--\s*endModule\s*-->)/gi;

var DETECT = {
    js: /<script.*src=['"](.+)['"]>/gi,
    css: /<link.*href=['"](.+)['"]/gi
};

var REPLACE = {
    js: '<script src="{{filePath}}"></script>',
    css: '<link rel="stylesheet" href="{{filePath}}" />'
};

var replaceHtmlContent = function (htmlContent, htmlFilePath) {

    var returnType = /\r\n/.test(htmlContent) ? '\r\n' : '\n';

    return htmlContent.replace(PATTERN, function (
            match, startComment, spacing, type, module, oldScripts, endComment,
            offset, string) {
        var filesCaught = [];
        type = type || 'js';


        var newHtmlContent = startComment;

        // verifica as referencias fora do bloco, para evitar duplicidade
        if (DETECT[type]) {
            string = string.substr(0, offset) + string.substr(offset + match.length);
            string.replace(oldScripts, '').replace(DETECT[type], function (match, reference) {
                filesCaught.push(reference);
                return match;
            });
        }

        spacing = returnType + spacing.replace(/\r|\n/g, '');

        // Obtém os arquivos a serem inseridos
        var modulePath = path.join(path.dirname(htmlFilePath), module);

        // registra o módulo sendo carregado
        MODULES_LOADED.push(modulePath);

        if (REPLACE[type]) {
            glob.sync(path.join(modulePath, '/**/*.' + type))
                    // gera o caminho relativo dos arquivos
                    .map(function (depPath) {
                        return path.join(
                                path.relative(path.dirname(htmlFilePath), path.dirname(depPath)),
                                path.basename(depPath)
                                ).replace(/\\/g, '/');
                    })
                    // ordena os arquivos alfabeticamente
                    .sort(function (pathA, pathB) {
                        var pa = path.dirname(pathA);
                        var pb = path.dirname(pathB);
                        if(pa === pb){
                            return 0;
                        }
                        if(pa.indexOf(pb) === 0){
                            return 1;
                        }
                        return pa.localeCompare(pb);
                    })
                    // remove os arquivos já carregados em outro ponto
                    .filter(function (relativeDepPath) {
                        return filesCaught.indexOf(relativeDepPath) === -1;
                    })
                    // finalmente modifica o html
                    .forEach(function (filePath) {
                        newHtmlContent += spacing + REPLACE[type].replace('{{filePath}}', filePath);
                    });
        }

        return newHtmlContent + spacing + endComment;
    });
};



function moduleDepGrunt(grunt) {
    grunt.registerMultiTask('moduleDep', 'Inject modules dependencies into your source code.', function () {

        // limpa a lista de módulos carregados
        MODULES_LOADED = [];

        this.requiresConfig(['moduleDep', this.target, 'src']);

        var options = this.options(this.data);

        if (this.files.length < 1) {
            grunt.verbose.warn('Destination not written because no source files were provided.');
        }

        var countModified = 0;

        // Faz o parsing de todos os arquivos
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
                        grunt.file.write(filepath, newHtmlContent);
                        grunt.log.writeln('File ' + chalk.cyan(filepath) + ' modified.');
                        countModified++;
                    }
                } catch (e) {
                    grunt.log.error(e);
                    grunt.fail.warn('moduleDep failed to parse "' + filepath + '".');
                    return false;
                }
            });
        });


        // após tratar os arquivos atualiza as dependencias do bower
        if (grunt.file.exists('bower.json')) {
            grunt.log.writeln('Check bower.json dependencies');

            var bowerJson = grunt.file.readJSON('bower.json');
            if (!bowerJson.dependencies) {
                bowerJson.dependencies = {};
            }

            var bowerJsonOrig = JSON.stringify(bowerJson, null, 4);

            _.each(_.uniq(MODULES_LOADED), function (modulePath) {
                var dep = path.join(modulePath, 'bower_dependencies.json');
                if (grunt.file.exists(dep)) {
                    var dependencies = grunt.file.readJSON(dep);
                    if (_.isObject(dependencies)) {
                        bowerJson.dependencies = _.merge(dependencies, bowerJson.dependencies);
                    }
                }
            });

            // organiza as dependencias em ordem alfabética
            var dependenciesSorted = {};
            _.each(_.keys(bowerJson.dependencies).sort(), function (k) {
                dependenciesSorted[k] = bowerJson.dependencies[k];
            });
            bowerJson.dependencies = dependenciesSorted;

            var bowerJsonDest = JSON.stringify(bowerJson, null, 4);
            if (bowerJsonOrig !== bowerJsonDest) {
                grunt.file.write('bower.json', bowerJsonDest);
                grunt.log.writeln('bower.json dependencies updated');
                countModified++;
            }
        }

        grunt.log.ok(countModified + ' ' + grunt.util.pluralize(countModified, 'file/files') + ' modified.');
    });
}

module.exports = moduleDepGrunt;
