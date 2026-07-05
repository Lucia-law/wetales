import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ASR 接口：接收音频文件，转发给硅基流动语音转文字 API。
 * 前端录音后上传，返回 { text: string }。
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ASR_API_KEY;
    const baseUrl =
      process.env.ASR_BASE_URL || "https://api.siliconflow.cn/v1";
    const model = process.env.ASR_MODEL || "FunAudioLLM/SenseVoiceSmall";

    if (!apiKey) {
      return NextResponse.json(
        { error: "ASR_API_KEY 未配置" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get("file") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: "缺少 audio 文件" },
        { status: 400 }
      );
    }

    // 转发给硅基流动
    const forwardForm = new FormData();
    forwardForm.append("file", audioFile, audioFile.name || "audio.webm");
    forwardForm.append("model", model);

    const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: forwardForm,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `ASR 请求失败 ${resp.status}: ${text.slice(0, 500)}` },
        { status: resp.status }
      );
    }

    const data = await resp.json();
    return NextResponse.json({ text: data.text || "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `ASR 服务异常: ${msg}` },
      { status: 500 }
    );
  }
}
