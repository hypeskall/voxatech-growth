import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({error:"Integrare retrasă."},{status:410}); }
