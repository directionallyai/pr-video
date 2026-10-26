import React from "react";
import { Composition } from "remotion";
import { Tour, tourFrames, type TourProps } from "./Tour";

const EMPTY: TourProps = {
  title: { kicker: "CODE TOUR", title: "No tour loaded", status: "render with --props=tour.json" },
  stops: [],
  verdict: { headline: "Nothing to review.", items: [] },
};

export const Root: React.FC = () => (
  <Composition
    id="Tour"
    component={Tour}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={EMPTY}
    calculateMetadata={({ props }) => ({ durationInFrames: tourFrames(props) })}
  />
);
