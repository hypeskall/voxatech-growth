import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json(
    {
      error:
        "WhatsApp neconfigurat. Este necesar un adaptor verificat și consimțământ pentru conversație.",
    },
    { status: 503 },
  );
}
