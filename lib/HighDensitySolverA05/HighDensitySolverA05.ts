import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../HighDensitySolverA03/HighDensitySolverA03"

export interface HighDensitySolverA05Props extends HighDensitySolverA03Props {}

export class HighDensitySolverA05 extends HighDensitySolverA03 {
  constructor(props: HighDensitySolverA05Props) {
    super({
      ...props,
      highResolutionCellThickness: props.highResolutionCellThickness ?? 4,
      postRouteSegmentCount: props.postRouteSegmentCount ?? 16,
      postRouteForceDirectedSteps: props.postRouteForceDirectedSteps ?? 200,
      hyperParameters: {
        ...props.hyperParameters,
        greedyMultiplier: props.hyperParameters?.greedyMultiplier ?? 2,
      },
    })
  }

  override getConstructorParams(): [HighDensitySolverA05Props] {
    const [params] = super.getConstructorParams()
    return [params]
  }
}

export { HighDensitySolverA05 as HighDensityA05Solver }
