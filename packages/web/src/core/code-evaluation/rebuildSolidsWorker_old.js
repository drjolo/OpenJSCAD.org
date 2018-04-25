const doExportsContainParameterDefinitions = require('@jscad/core/code-loading/doExportsContainParameterDefinitions')

function loadFromText (scriptAsText, mainPath, apiMainPath) {
  const csgBasePath = '@jscad/csg/api'

  let modules = {
    '@jscad/csg/api': {
      exports: require('@jscad/csg/api')
    },
    '@jscad/io': {
      exports: require('@jscad/io')
    }
  }
  const getParamsString = scriptAsText.includes('getParameterDefinitions')
      ? 'module.exports.getParameterDefinitions = getParameterDefinitions' : ''
  const script = `
    const deserializeStl = require('@jscad/io').stlDeSerializer.deserialize
    
    const {CSG, CAG} = require('${csgBasePath}').csg
    const {square, circle, polygon} = require('${csgBasePath}').primitives2d
    const {cube, cylinder, sphere, polyhedron, torus} = require('${csgBasePath}').primitives3d
    const {color} = require('${csgBasePath}').color
    const {rectangular_extrude, linear_extrude, rotate_extrude} = require('${csgBasePath}').extrusions
    const {rotate, translate, scale, mirror, hull, chain_hull, expand, contract} = require('${csgBasePath}').transformations
    const {union, difference, intersection} = require('${csgBasePath}').booleanOps
    const {sin, cos, tan, sqrt, lookup} = require('${csgBasePath}').maths
    const {hsl2rgb} = require('${csgBasePath}').color
    const {vector_text, vector_char} = require('${csgBasePath}').text
    const {OpenJsCad} = require('${csgBasePath}').OpenJsCad
    const {echo} = require('${csgBasePath}').debug 
    ${scriptAsText}

    module.exports = {main}
    ${getParamsString}
  `
  // console.log('script', script)
  const rootModule = new Function('require', 'module', script)
  const mockRequire = function (pathToModule) {
    //console.log('you asked for', pathToModule)
    const foundModule = modules[pathToModule]
    return foundModule.exports
  }
  let module = {}
  rootModule(mockRequire, module)
  // console.log('module', module)
  const designRootModule = module.exports

  let params = {}
  let parameterDefinitions = []
  if (doExportsContainParameterDefinitions(designRootModule)) {
    const getParameterValuesFromParameters = require('@jscad/core/parameters/getParameterValuesFromParameters')

    parameterDefinitions = designRootModule.getParameterDefinitions() || []
    params = getParameterValuesFromParameters(designRootModule.getParameterDefinitions)
  }
  return {designRootModule, params, parameterDefinitions}
}

module.exports = function (self) {
  const makeBuildCachedGeometryFromTree = require('jscad-tree-experiment').buildCachedGeometry
  const { CAG, CSG } = require('@jscad/csg')

  self.onmessage = function (event) {
    if (event.data instanceof Object) {
      // console.log('in web worker')
      const {data} = event
      if (data.cmd === 'render') {
        const {source, parameters, mainPath, options} = data
        const {vtreeMode, lookup, lookupCounts} = Object.assign({}, defaults, options)
        const apiMainPath = vtreeMode ? './vtreeApi' : '@jscad/csg/api'

        const {isCAG, isCSG} = require('@jscad/csg')
        const {toArray} = require('../../utils/utils')

        // const {loadScript} = require('../code-loading/scriptLoading')
        // const requireUncached = require('../code-loading/requireUncached')
        // TODO: only uncache when needed
        // requireUncached(mainPath)
        const {designRootModule, params, parameterDefinitions} = loadFromText(source, mainPath, apiMainPath)
        // const {designRootModule, params, parameterDefinitions} = loadScript(source, mainPath, apiMainPath)

        const paramDefaults = params
        const paramValues = Object.assign({}, paramDefaults, parameters)
        let convertedLookup = {}

        // send back parameter definitions & values
        self.postMessage({'type': 'params', paramDefaults, paramValues, parameterDefinitions})

        // deal with the actual solids generation
        let solids
        let rawResults = toArray(designRootModule.main(paramValues))
        const isSolidResult = (rawResults.length > 0 && (isCSG(rawResults[0]) || isCAG(rawResults[0])))
        if (isSolidResult) {
          solids = rawResults
        } else if (vtreeMode) {
          // TODO: optimise this !!
          Object.keys(lookup).forEach(function (key) {
            const object = lookup[key]
            let result
            if (object['class'] === 'CSG') {
              result = CSG.fromCompactBinary(object)
            }
            if (object['class'] === 'CAG') {
              result = CAG.fromCompactBinary(object)
            }
            convertedLookup[key] = result
          })

          const buildCachedGeometryFromTree = makeBuildCachedGeometryFromTree({passesBeforeElimination: 3, lookup: convertedLookup, lookupCounts})
          solids = buildCachedGeometryFromTree({}, rawResults)
        } else {
          throw new Error('Bad output from script: expected CSG/CAG objects')
        }
        solids = solids
          .map(object => {
            if (isCSG(object) || isCAG(object)) {
              return object.toCompactBinary()
            }
          })

        // FIXME: optimise this !!
        const compactLookup = {}
        Object.keys(convertedLookup).forEach(function (key) {
          const object = convertedLookup[key]
          let result = object
          // FIXME: isCSG/isCAG should not fail on arbitraty objects
          try {
            if (isCSG(object) || isCAG(object)) {
              result = object.toCompactBinary()
              compactLookup[key] = result
            }
          } catch (e) {}
        })
        // send back solids
        self.postMessage({'type': 'solids', solids, lookup: compactLookup, lookupCounts})
      }
    }
  }
}
//