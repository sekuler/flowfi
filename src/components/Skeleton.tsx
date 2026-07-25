interface Props {
  width?: number | string;
  height?: number;
}

export default function Skeleton({ width = 60, height = 16 }: Props) {
  return <span className="flowfi-skeleton" style={{ width, height, verticalAlign: "middle" }} />;
}
