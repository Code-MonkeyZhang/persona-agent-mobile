#import "PlatformModule.h"

@implementation PlatformModule

RCT_EXPORT_MODULE();

- (NSDictionary *)constantsToExport
{
    NSString *buildNumber = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleVersion"];

    return @{
        @"buildNumber": buildNumber ?: @""
    };
}

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

@end 