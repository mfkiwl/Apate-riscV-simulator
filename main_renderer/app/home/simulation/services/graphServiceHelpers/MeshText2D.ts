import * as THREE from 'three';
import { Text2D } from 'three-text2d/lib/Text2D';

/**
 * Same as library but with different filtering
 */
export class MeshText2D extends Text2D {

  public mesh: THREE.Mesh;

  protected geometry: THREE.PlaneGeometry;

  constructor(text = '', options = {}) {
    super(text, options);
  }

  raycast (): void {
    this.mesh.raycast.apply(this.mesh, arguments)
  }

  updateText(): void {
    this.cleanUp() // cleanup previous texture

    this.canvas.drawText(this._text, {
      font: this._font,
      fillStyle: this._fillStyle,
      shadowBlur: this._shadowBlur,
      shadowColor: this._shadowColor,
      shadowOffsetX: this._shadowOffsetX,
      shadowOffsetY: this._shadowOffsetY,
      lineHeight: this._lineHeight,
      align: this.align,
      backgroundColor: this._backgroundColor,
      horizontalPadding: this._horizontalPadding,
      verticalPadding: this._verticalPadding
    })

    this.texture = new THREE.Texture(this.canvas.canvas);
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 16;
    this.texture.magFilter = THREE.LinearMipMapLinearFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;

    if (!this.material) {
      this.material = new THREE.MeshBasicMaterial({ map: this.texture, side: this.side });
      this.material.transparent = true

    } else {
      this.material.map = this.texture
    }

    if (!this.mesh) {
      this.geometry = new THREE.PlaneGeometry(this.canvas.width, this.canvas.height);
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.add(this.mesh)
    }

    this.mesh.position.x = ((this.canvas.width/2) - (this.canvas.textWidth/2)) + ((this.canvas.textWidth/2) * this.align.x)
    this.mesh.position.y = (- this.canvas.height/2) + ((this.canvas.textHeight/2) * this.align.y)

    // manually update geometry vertices
    this.geometry.vertices[0].x = this.geometry.vertices[2].x = -this.canvas.width/2
    this.geometry.vertices[1].x = this.geometry.vertices[3].x = this.canvas.width/2
    this.geometry.vertices[0].y = this.geometry.vertices[1].y = this.canvas.height/2
    this.geometry.vertices[2].y = this.geometry.vertices[3].y = -this.canvas.height/2
    this.geometry.verticesNeedUpdate = true
  }

}
