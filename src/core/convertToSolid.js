import { CSG, CAG } from '@jscad/csg'

// FIXME: is there not too much overlap with convertToBlob ?
/**
 * convert objects to a single solid
 * @param {Array} objects the list of objects
 * @return {Object} solid : the single CSG object
 */
export default function convertToSolid (objects, params) {
  if (objects.length === undefined) {
    if ((objects instanceof CAG) || (objects instanceof CSG)) {
      var obj = objects
      objects = [obj]
    } else {
      throw new Error('Cannot convert object (' + typeof (objects) + ') to solid')
    }
  }

  var solid = null
  for (var i = 0; i < objects.length; i++) {
    let obj = objects[i]
    if (obj instanceof CAG) {
      obj = obj.extrude({offset: [0, 0, 0.1]}) // convert CAG to a thin solid CSG
    }
    if (solid !== null) {
      solid = solid.unionForNonIntersecting(obj)
    } else {
      solid = obj
    }
  }
  return solid
}
