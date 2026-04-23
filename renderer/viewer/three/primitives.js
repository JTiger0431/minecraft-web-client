/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */
const THREE = require('three')

function getMesh(primitive) {
  if (primitive.type === 'line') {
    const color = primitive.color ? primitive.color : 0xff0000
    const material = new THREE.LineBasicMaterial({ color })

    const points = []
    for (const p of primitive.points) {
      points.push(p.x, p.y, p.z)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return new THREE.Line(geometry, material)
  } else if (primitive.type === 'boxgrid') {
    const color = primitive.color ? primitive.color : 'aqua'

    const sx = primitive.end.x - primitive.start.x
    const sy = primitive.end.y - primitive.start.y
    const sz = primitive.end.z - primitive.start.z

    const boxGeometry = new THREE.BoxGeometry(
      Math.max(Math.abs(sx), 0.01),
      Math.max(Math.abs(sy), 0.01),
      Math.max(Math.abs(sz), 0.01)
    )
    const gridGeometry = new THREE.EdgesGeometry(boxGeometry)
    const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color }))
    grid.position.x = primitive.start.x + sx / 2
    grid.position.y = primitive.start.y + sy / 2
    grid.position.z = primitive.start.z + sz / 2
    return grid
  } else if (primitive.type === 'points') {
    const color = primitive.color ? primitive.color : 'aqua'
    const size = primitive.size ? primitive.size : 5
    const points = []
    for (const p of primitive.points) {
      points.push(p.x, p.y, p.z)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const material = new THREE.PointsMaterial({ color, size, sizeAttenuation: false })
    return new THREE.Points(geometry, material)
  }
  return null
}

function disposeObject (object) {
  object.traverse((child) => {
    child.geometry?.dispose?.()

    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose?.()
      }
    } else {
      child.material?.dispose?.()
    }
  })
}

class Primitives {
  constructor(scene) {
    this.scene = scene
    this.primitives = {}
  }

  clear() {
    for (const mesh of Object.values(this.primitives)) {
      this.scene.remove(mesh)
      disposeObject(mesh)
    }
    this.primitives = {}
  }

  remove(id) {
    const mesh = this.primitives[id]
    if (!mesh) return

    this.scene.remove(mesh)
    disposeObject(mesh)
    delete this.primitives[id]
  }

  update(primitive) {
    this.remove(primitive.id)

    const mesh = getMesh(primitive)
    if (!mesh) return
    this.primitives[primitive.id] = mesh
    this.scene.add(mesh)
  }
}

module.exports = { Primitives }
