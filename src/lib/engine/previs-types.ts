import type { Artifact, PrevisArtifact, PrevisShot } from "@/lib/types"

export function isPrevisArtifact(a: Artifact | PrevisArtifact | undefined): a is PrevisArtifact {
  return a?.kind === "previs"
}

/** 默认布景：中央地形 + 前景角色 + 右侧道具，机位正面平视 */
export function makePrevisShot(shotIndex: number): PrevisShot {
  return {
    shotIndex,
    camera: { position: [0, 2, 8], target: [0, 1, 0], fov: 45 },
    blocking: [
      { id: `ter-${shotIndex}`, kind: "terrain", name: "场景地形", position: [0, 0, 0], rotationY: 0, scale: 1 },
      { id: `ch-${shotIndex}`, kind: "character", name: "主角", position: [0, 0, 1], rotationY: 0, scale: 1 },
      { id: `prop-${shotIndex}`, kind: "prop", name: "关键道具", position: [2, 0, 0], rotationY: 0, scale: 0.8 },
    ],
    previewSvg: "",
    depthSvg: "",
    edgeSvg: "",
  }
}
