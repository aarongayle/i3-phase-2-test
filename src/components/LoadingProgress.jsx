export default function LoadingProgress({ progress, isVisible }) {
  if (!isVisible) return null;

  // Calculate overall progress
  const stages = Object.entries(progress || {});
  const totalProgress =
    stages.length > 0
      ? stages.reduce((sum, [, data]) => sum + (data.progress || 0), 0) /
        stages.length
      : 0;

  // Get current stage info
  const currentStage =
    stages.find(([, data]) => data.progress < 100 && data.progress > 0) ||
    stages[0];
  const [stageName, stageData] = currentStage || [
    "init",
    { progress: 0, message: "" },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 text-center">
          Loading Report Data
        </h2>

        {/* Overall Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Overall Progress</span>
            <span>{Math.round(totalProgress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all duration-300 ease-out"
              style={{ width: `${totalProgress}%` }}
            ></div>
          </div>
        </div>

        {/* Current Stage */}
        <div className="space-y-4">
          {Object.entries(progress || {}).map(([stage, data]) => {
            const isActive = data.progress > 0 && data.progress < 100;
            const isComplete = data.progress === 100;

            return (
              <div
                key={stage}
                className={`transition-opacity duration-300 ${
                  isActive || isComplete ? "opacity-100" : "opacity-40"
                }`}
              >
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700 capitalize">
                    {stage === "metadata"
                      ? "Metadata"
                      : stage === "history"
                      ? "History"
                      : stage === "aggregation"
                      ? "Aggregation"
                      : stage === "energy"
                      ? "Energy Data"
                      : stage}
                  </span>
                  <span
                    className={`${
                      isComplete
                        ? "text-green-600"
                        : isActive
                        ? "text-blue-600"
                        : "text-gray-500"
                    }`}
                  >
                    {isComplete ? "✓" : `${data.progress || 0}%`}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isComplete
                        ? "bg-green-500"
                        : isActive
                        ? "bg-blue-600"
                        : "bg-gray-300"
                    }`}
                    style={{ width: `${data.progress || 0}%` }}
                  ></div>
                </div>
                {data.message && (
                  <p className="text-xs text-gray-500 mt-1">{data.message}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Loading Spinner */}
        <div className="flex justify-center mt-6">
          <div className="relative w-12 h-12">
            <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-200 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
          </div>
        </div>

        <p className="text-gray-500 text-center text-sm mt-4">
          {stageData.message || "Processing..."}
        </p>
      </div>
    </div>
  );
}
