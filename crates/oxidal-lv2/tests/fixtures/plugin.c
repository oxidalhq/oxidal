// Authored ABI/processing fixture, not a musical effect or a model of a third-party plugin.
#include <lv2/core/lv2.h>
#include <lv2/urid/urid.h>
#include <lv2/options/options.h>
#include <lv2/buf-size/buf-size.h>
#include <lv2/atom/atom.h>
#include <stdlib.h>
#include <string.h>
typedef struct {float* p[6];float history[2][2048];uint32_t frames;} Test;
static LV2_Handle create(const LV2_Descriptor* d,double rate,const char* path,const LV2_Feature*const* features) {
    (void)d;(void)rate;(void)path;
    LV2_URID_Map* map=NULL;LV2_URID_Unmap* unmap=NULL;const LV2_Options_Option* opts=NULL;int fixed=0,bounded=0,power=0;
    for (int i=0;features && features[i];i++) {
        if (!strcmp(features[i]->URI,LV2_URID__map)) map=features[i]->data;
        if (!strcmp(features[i]->URI,LV2_URID__unmap)) unmap=features[i]->data;
        if (!strcmp(features[i]->URI,LV2_OPTIONS__options)) opts=features[i]->data;
        fixed|=!strcmp(features[i]->URI,LV2_BUF_SIZE__fixedBlockLength);
        bounded|=!strcmp(features[i]->URI,LV2_BUF_SIZE__boundedBlockLength);
        power|=!strcmp(features[i]->URI,LV2_BUF_SIZE__powerOf2BlockLength);
    }
    if (!map||!unmap||!opts||!fixed||!bounded||!power) return NULL;
    uint32_t sizes[3]={0};const char* keys[]={LV2_BUF_SIZE__minBlockLength,LV2_BUF_SIZE__maxBlockLength,LV2_BUF_SIZE__nominalBlockLength};
    for (int i=0;i<3;i++) for (const LV2_Options_Option* o=opts;o->key;o++) if (o->key==map->map(map->handle,keys[i])) {
        if (o->type!=map->map(map->handle,LV2_ATOM__Int)||o->size!=sizeof(int32_t)||o->context!=LV2_OPTIONS_INSTANCE) return NULL;
        sizes[i]=*(const uint32_t*)o->value;
    }
    if (!sizes[0]||sizes[0]>2048||sizes[0]!=sizes[1]||sizes[0]!=sizes[2]||(sizes[0]&(sizes[0]-1))) return NULL;
    LV2_URID id=map->map(map->handle,"urn:oxidal:test:roundtrip");
    if (!id||strcmp(unmap->unmap(unmap->handle,id),"urn:oxidal:test:roundtrip")) return NULL;
    Test* t=calloc(1,sizeof(Test));if(t)t->frames=sizes[0];return t;
}
static void connect(LV2_Handle h,uint32_t p,void* data){if(p<6)((Test*)h)->p[p]=data;}
static void run(LV2_Handle h,uint32_t n){Test* t=h;if(n!=t->frames)abort();for(uint32_t c=0;c<2;c++)for(uint32_t i=0;i<n;i++){float v=t->p[c][i]*(*t->p[4])+t->history[c][i]*(*t->p[5]);t->history[c][i]=v;t->p[2+c][i]=v;}}
static void cleanup(LV2_Handle h){free(h);}
static const LV2_Descriptor descriptor={"urn:oxidal:test:contract",create,connect,NULL,run,NULL,cleanup,NULL};
LV2_SYMBOL_EXPORT const LV2_Descriptor* lv2_descriptor(uint32_t index){return index?NULL:&descriptor;}
