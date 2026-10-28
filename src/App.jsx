import React, { useState, useRef, useEffect } from 'react';
import ToolFAQ from './components/ToolFAQ';

import BrandedNav from './components/BrandedNav';
import BrandedFooter from './components/BrandedFooter';
import { 
  Upload, Play, Pause, Volume2, VolumeX,
  Settings, Scissors, SkipBack, SkipForward, Repeat,
  Loader2, CheckCircle2, AlertCircle, AlertTriangle, Download
} from 'lucide-react';
import { useToolUsage } from './hooks/useToolUsage';

export default function AutoSilenceRemover() {
  const { checkUsage, incrementUsage } = useToolUsage();

  const faqs = [
    {
      "question": "How does the silence remover work?",
      "answer": "It analyzes your video's audio track, identifies segments that fall below a specific volume threshold for a set duration, and cuts them out."
    },
    {
      "question": "Will it cut out quiet talking?",
      "answer": "Not if you set the threshold correctly! You can adjust the decibel level to ensure only true silence is removed."
    },
    {
      "question": "Can I adjust how aggressive the cuts are?",
      "answer": "Yes, you can configure both the volume threshold and the minimum silence duration before processing."
    },
    {
      "question": "Does this affect video quality?",
      "answer": "No, we use high-quality encoding to ensure your video retains its original resolution and bitrate."
    },
    {
      "question": "Is it better than editing manually?",
      "answer": "It saves hours of tedious manual cutting. You can always use this tool first to create a rough cut, then refine it in your editor."
    }
  ];

  const [tolerance, setTolerance] = useState(-35);
  const [minDuration, setMinDuration] = useState(0.5);
  
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  
  // Video state
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLooping, setIsLooping] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('Booting Engine...');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [resultVideoUrl, setResultVideoUrl] = useState(null);
  const [downloadFileName, setDownloadFileName] = useState("");

  const ffmpegRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const loadStarted = useRef(false);

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;

    const loadFFmpeg = async () => {
      try {
        setLoadingMsg("Fetching Engine...");
        const { createFFmpeg } = window.FFmpeg;
        const ffmpeg = createFFmpeg({
           log: true,
           corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
        });
        ffmpegRef.current = ffmpeg;
        await ffmpeg.load();
        setIsReady(true);
        setLoadingMsg('Engine Loaded');
        setError(null);
      } catch (err) {
        console.error("FFmpeg load error:", err);
        setError("Error: " + (err.message || "Failed to initialize WebAssembly."));
        setLoadingMsg("Failed to Load");
      }
    };
    
    setTimeout(() => {
        if (window.FFmpeg) {
            loadFFmpeg();
        } else {
            setError("Global FFmpeg library failed to inject.");
        }
    }, 500);
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type.startsWith('video/')) {
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setVideoUrl(url);
      setError(null);
    } else {
        setError('Please upload a valid video file.');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      setFile(droppedFile);
      const url = URL.createObjectURL(droppedFile);
      setVideoUrl(url);
      setError(null);
    } else {
        setError('Please upload a valid video file.');
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const p = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      setProgress(p);
    }
  };

  const handleScrub = (e) => {
    if (videoRef.current) {
      const scrubTime = (e.target.value / 100) * videoRef.current.duration;
      videoRef.current.currentTime = scrubTime;
      setProgress(e.target.value);
    }
  };

  const stepFrame = (forward) => {
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
      videoRef.current.currentTime += forward ? 0.033 : -0.033;
    }
  };

  const getVideoDuration = (fileObj) => new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.src = URL.createObjectURL(fileObj);
  });

  const handleProcess = async () => {
    if (!checkUsage()) {
      setError("Daily limit reached. Free users can process tools 3 times a day. Please upgrade for unlimited access.");
      return;
    }
    incrementUsage();

    if (!file || !isReady) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setResultVideoUrl(null);
    setProcessProgress(0);
    setDownloadFileName(file.name);

    try {
      const ffmpeg = ffmpegRef.current;
      const { fetchFile } = window.FFmpeg;
      
      setLoadingMsg('Uploading to virtual filesystem...');
      ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(file));

      setLoadingMsg('Detecting silence...');
      setProcessProgress(10);
      
      let silenceStarts = [];
      let silenceEnds = [];
      
      const logCallback = ({ message }) => {
        if (message.includes('silence_start:')) {
          const match = message.match(/silence_start:\s+([-\d\.]+)/);
          if (match) silenceStarts.push(parseFloat(match[1]));
        } else if (message.includes('silence_end:')) {
          const match = message.match(/silence_end:\s+([-\d\.]+)/);
          if (match) silenceEnds.push(parseFloat(match[1]));
        }
      };

      ffmpeg.setLogger(logCallback);

      await ffmpeg.run(
        '-i', 'input.mp4',
        '-af', `silencedetect=n=${tolerance}dB:d=${minDuration}`,
        '-f', 'null', '-'
      );

      ffmpeg.setLogger(({ message }) => console.log(message));

      const totalDuration = await getVideoDuration(file);
      
      let keepChunks = [];
      let currentTime = 0.0;
      const len = Math.min(silenceStarts.length, silenceEnds.length);
      
      for (let i = 0; i < len; i++) {
         const start = silenceStarts[i];
         const end = silenceEnds[i];
         if (start > currentTime) {
            keepChunks.push({ start: currentTime, end: start });
         }
         currentTime = end;
      }
      if (currentTime < totalDuration) {
         keepChunks.push({ start: currentTime, end: totalDuration });
      }

      if (keepChunks.length === 0) {
         throw new Error("The entire video appears to be silent. Adjust your threshold.");
      }

      setLoadingMsg(`Slicing non-silent segments...`);
      let concatList = '';
      
      for (let i = 0; i < keepChunks.length; i++) {
         const chunk = keepChunks[i];
         const chunkName = `chunk_${i}.mp4`;
         await ffmpeg.run(
           '-y',
           '-ss', String(chunk.start),
           '-to', String(chunk.end),
           '-i', 'input.mp4',
           '-c', 'copy',
           '-avoid_negative_ts', 'make_zero',
           chunkName
         );
         concatList += `file '${chunkName}'\n`;
         setProcessProgress(10 + Math.round(((i+1) / keepChunks.length) * 40));
      }

      setLoadingMsg("Merging final video...");
      ffmpeg.FS('writeFile', 'concat_list.txt', new TextEncoder().encode(concatList));
      
      setProcessProgress(75);
      
      await ffmpeg.run(
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', 'concat_list.txt',
          '-c', 'copy',
          'output.mp4'
      );

      setProcessProgress(100);
      setLoadingMsg("Finalizing download...");

      const data = ffmpeg.FS('readFile', 'output.mp4');
      const url = window.URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
      
      setResultVideoUrl(url);
      setResult({ message: 'Success! Silences have been removed.' });

      ffmpeg.FS('unlink', 'input.mp4');
      ffmpeg.FS('unlink', 'concat_list.txt');
      ffmpeg.FS('unlink', 'output.mp4');

    } catch (err) {
      console.error(err);
      setError(err.message || 'An error occurred during processing. Is the video completely silent?');
    } finally {
      setIsProcessing(false);
      setProcessProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white p-6 md:p-12">
      
      <BrandedNav />
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3">
              <Scissors className="text-emerald-500" /> Auto Silence Remover
            </h1>
            <p className="text-gray-400 font-medium">Dynamically cut dead air and pauses</p>
          </div>
          {videoUrl && !isProcessing && (
            <button 
              onClick={() => { setFile(null); setVideoUrl(null); setResult(null); setError(null); }}
              className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full font-bold text-sm transition-colors border border-white/10"
            >
              Upload New Video
            </button>
          )}
        </div>

        {!videoUrl ? (
          <div 
            className="w-full max-w-3xl mx-auto h-[60vh] border-2 border-dashed border-white/10 rounded-[2rem] flex flex-col items-center justify-center p-8 text-center hover:bg-white/5 hover:border-emerald-500/50 transition-all cursor-pointer group"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              id="video-input" 
              accept="video/*" 
              className="hidden" 
              onChange={handleFileChange}
            />
            <label htmlFor="video-input" className="cursor-pointer flex flex-col items-center w-full h-full justify-center">
              <div className="w-20 h-20 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Upload size={32} />
              </div>
              <h2 className="text-2xl font-black mb-2">Select a Video</h2>
              <p className="text-gray-400 max-w-sm">Drag and drop your .mp4 or .mov file here to remove silences.</p>
              <div className="mt-8 px-4 py-2 bg-white/5 rounded-full text-xs font-bold text-gray-500 uppercase tracking-widest">
                Local Processing • Zero Uploads
              </div>
            </label>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Main Preview Area */}
            <div className="flex-1 flex flex-col items-center">
              <div className="w-full bg-black rounded-3xl border border-white/10 shadow-2xl overflow-hidden shrink-0 aspect-video flex items-center justify-center">
                {resultVideoUrl ? (
                  <video 
                    src={resultVideoUrl}
                    className="w-full h-full object-contain bg-zinc-900"
                    controls
                    playsInline
                  />
                ) : (
                  <video 
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full h-full object-contain bg-zinc-900"
                    onTimeUpdate={handleTimeUpdate}
                    loop={isLooping}
                    muted={isMuted}
                    playsInline
                  />
                )}
              </div>

              {/* Transport Controls */}
              {!resultVideoUrl && (
                <div className="w-full mt-6 bg-white/5 rounded-2xl p-4 border border-white/10 backdrop-blur-md">
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={() => stepFrame(false)} className="p-2 text-gray-400 hover:text-white"><SkipBack size={20} /></button>
                    <button onClick={togglePlay} className="w-12 h-12 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform">
                      {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
                    </button>
                    <button onClick={() => stepFrame(true)} className="p-2 text-gray-400 hover:text-white"><SkipForward size={20} /></button>
                  </div>
                  
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={progress}
                    onChange={handleScrub}
                    className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  
                  <div className="flex justify-between mt-4">
                    <button onClick={() => setIsMuted(!isMuted)} className={`p-2 rounded-lg ${isMuted ? 'text-red-400 bg-red-400/10' : 'text-gray-400 hover:text-white'}`}>
                      {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    <button onClick={() => setIsLooping(!isLooping)} className={`p-2 rounded-lg ${isLooping ? 'text-emerald-400 bg-emerald-400/10' : 'text-gray-400 hover:text-white'}`}>
                      <Repeat size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar Settings */}
            <div className="w-full lg:w-[350px] space-y-6">
              
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
                 <AlertTriangle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                 <div className="text-emerald-200 text-xs">
                   <span className="font-bold text-emerald-400">Editing Notice:</span> 
                   This uses lossless stream copying for high speed, avoiding quality degradation.
                </div>
              </div>

              {/* Settings */}
              {!result && !isProcessing && (
                <div className="glass-card p-6 rounded-3xl border border-white/10 bg-white/5">
                  <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-6 flex items-center gap-2">
                    <Settings size={16} /> Cut Parameters
                  </h3>
                  
                  <div className="space-y-6">
                    <div>
                      <div className="flex justify-between text-xs font-mono text-gray-400 mb-2">
                        <span>Silence Threshold: {tolerance}dB</span>
                      </div>
                      <input 
                        type="range" 
                        min="-60" max="-10" 
                        value={tolerance} 
                        onChange={(e) => setTolerance(e.target.value)} 
                        className="w-full accent-emerald-500" 
                      />
                      <p className="text-[10px] text-gray-500 mt-1 flex justify-between">
                         <span>Quieter</span><span>Louder</span>
                      </p>
                    </div>
                    
                    <div>
                      <div className="flex justify-between text-xs font-mono text-gray-400 mb-2">
                        <span>Min Duration: {minDuration}s</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.1" max="2.0" step="0.1" 
                        value={minDuration} 
                        onChange={(e) => setMinDuration(e.target.value)} 
                        className="w-full accent-emerald-500" 
                      />
                      <p className="text-[10px] text-gray-500 mt-1 flex justify-between">
                         <span>Shorter Pauses</span><span>Longer Pauses</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-200 text-sm">{error}</p>
                </div>
              )}

              {result && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-300 mb-4">{result.message}</p>
                  <div className="flex flex-col gap-3">
                    {resultVideoUrl && (
                      <a 
                        href={resultVideoUrl} 
                        download={`nosilence_${downloadFileName}`}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all text-sm"
                      >
                        <Download size={16} />
                        Download Edited Video
                      </a>
                    )}
                  </div>
                </div>
              )}

              {!result && (
                <button 
                  onClick={handleProcess}
                  disabled={isProcessing || !isReady}
                  className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl transition-all flex flex-col items-center justify-center gap-2 transform relative overflow-hidden ${
                    isProcessing || !isReady
                      ? 'bg-white/10 text-white/50 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 hover:-translate-y-1'
                  }`}
                >
                  {isProcessing && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 bg-white/20 transition-all duration-300"
                      style={{ width: `${processProgress}%` }}
                    ></div>
                  )}
                  
                  <div className="relative flex items-center gap-2">
                    {(isProcessing || !isReady) ? <Loader2 size={18} className="animate-spin" /> : <Scissors size={18} />}
                    {isProcessing || !isReady ? loadingMsg : 'Remove Silence'}
                  </div>
                </button>
              )}

            </div>
          </div>
        )}
      </div>

      {/* SEO Sections */}
      <div className="mt-24 space-y-24 max-w-4xl mx-auto px-4">
        {/* How It Works */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">How to Automatically Cut Silences</h2>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-500/20">1</div>
              <h3 className="text-xl font-bold mb-3 text-emerald-400 mt-2">Upload File</h3>
              <p className="text-gray-400">Import your video directly from your device storage into the tool.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-blue-500/20">2</div>
              <h3 className="text-xl font-bold mb-3 text-blue-400 mt-2">Set Params</h3>
              <p className="text-gray-400">Adjust the volume threshold and duration so only true pauses are targeted.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/20">3</div>
              <h3 className="text-xl font-bold mb-3 text-indigo-400 mt-2">Analyze</h3>
              <p className="text-gray-400">Click remove and watch as our tool rapidly identifies every single silent gap.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-purple-500/20">4</div>
              <h3 className="text-xl font-bold mb-3 text-purple-400 mt-2">Export</h3>
              <p className="text-gray-400">Download a perfectly stitched video ready for upload or further editing.</p>
            </div>
          </div>
        </section>

        {/* Feature Breakdown */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">Why Use Auto Silence Remover?</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Saves Editing Time</h3>
              <p className="text-gray-400">Don't waste hours scrolling the timeline doing jump-cuts manually. Get a clean rough cut instantly.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Lossless Processing</h3>
              <p className="text-gray-400">Your final file preserves 100% of the original video and audio quality with smart concatenation.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Custom Thresholds</h3>
              <p className="text-gray-400">Fine-tune the dB limits and pause duration so you don't accidentally chop out important soft speech.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Secure Local Editing</h3>
              <p className="text-gray-400">Because files aren't uploaded anywhere, this tool protects your unpublished sensitive content entirely.</p>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">Built for Content Creators & Professionals</h2>
          <div className="space-y-6">
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">YouTubers & Vloggers</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Create highly engaging, fast-paced content with zero dead air, matching modern algorithmic viewing habits.</p>
              </div>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Course Instructors</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Easily condense lengthy unscripted lectures down to just the essential talking points.</p>
              </div>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Podcast Editors</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Strip out long pauses from video podcasts, allowing conversations to flow naturally and professionally.</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ToolFAQ faqs={faqs} />
      <BrandedFooter />
    </div>
  );
}
