// A small header in the shape of LMU's, written for these tests. It is not
// the game's header: only the fields the recorder reads, plus one of each
// construct the parser has to handle.
#pragma pack( push, 4 )

enum class Klass : uint8_t { A, B, C };

struct TelemVect3
{
    union
    {
        struct
        {
            double x, y, z;
        };
        double data[3];
    };
    void Set( const double a, const double b, const double c ) { x = a; y = b; z = c; }
};

struct TelemWheelV01
{
  double mBrakeTemp;
  double mTemperature[3];       // Kelvin
  double mTireCarcassTemperature;
  float_t mOptimalTemp;
  unsigned char mExpansion[ 18 ];
};

struct TelemInfoV01
{
  long mID;
  double mElapsedTime;
  char mVehicleName[64];
  char mTrackName[64];
  TelemVect3 mPos;
  TelemVect3 mLocalVel;
  TelemVect3 mOri[3];
  long mGear;
  unsigned char mDentSeverity[8];
  Klass mVehicleClass;
  bool mABSActive, mTCActive;
  TelemWheelV01 mWheel[4];
};

struct VehicleScoringInfoV01
{
  long mID;
  char mVehicleName[64];
  unsigned char mPlace;
  double mLapDist;
  signed char mSector;
};

struct ScoringInfoV01
{
  char mTrackName[64];
  long mSession;
  double mCurrentET;
  char *mResultsStream;
  long mNumVehicles;
  char mPlayerName[32];
  char mServerName[32];
  unsigned char mGameMode;
  VehicleScoringInfoV01 *mVehicle;
};

#pragma pack( pop )

enum SharedMemoryEvent : uint32_t { SME_ENTER, SME_EXIT, SME_MAX };

struct SharedMemoryGeneric {
    SharedMemoryEvent events[SharedMemoryEvent::SME_MAX];
    long gameVersion;
    float FFBTorque;
};

struct SharedMemoryScoringData {
    ScoringInfoV01 scoringInfo;
    size_t scoringStreamSize;
    VehicleScoringInfoV01 vehScoringInfo[8];
    char scoringStream[16];
};

struct SharedMemoryTelemetryData {
    uint8_t activeVehicles;
    uint8_t playerVehicleIdx;
    bool playerHasVehicle;
    TelemInfoV01 telemInfo[8];
};

struct SharedMemoryPathData {
    char userData[MAX_PATH];
};

struct SharedMemoryObjectOut {
    SharedMemoryGeneric generic;
    SharedMemoryPathData paths;
    SharedMemoryScoringData scoring;
    SharedMemoryTelemetryData telemetry;
};
