import { StringColumn, NumberColumn, BoolColumn, ValueListColumn, ServerFunction, Allowed } from '@remult/core';
import { GeocodeInformation, GetGeoInformation, AddressColumn } from "../shared/googleApiHelpers";
import { Entity, Context, EntityClass } from '@remult/core';
import { PhoneColumn, logChanges } from "../model-shared/types";
import { Roles } from "../auth/roles";
import { DeliveryStatusColumn, DeliveryStatus } from "../families/DeliveryStatus";
import { translationConfig, TranslationOptionsColumn, Language, use, TranslationOptions } from "../translate";

import { FamilySources } from "../families/FamilySources";
import { Injectable } from '@angular/core';

import { BasketType } from '../families/BasketType';
import { HttpClient } from '@angular/common/http';
import { Sites, getLang, setLangForSite } from '../sites/sites';
import { routeStrategyColumn } from '../asign-family/route-strategy';
import { NumberContext } from 'twilio/lib/rest/pricing/v1/voice/number';



@EntityClass
export class ApplicationSettings extends Entity<number>  {

  getInternationalPhonePrefix() {
    let r = this.forWho.value.args.internationalPrefixForSmsAndAws;
    if (!r)
      r = '+972';
    return r;
  }
  googleMapCountry() {
    let r = this.forWho.value.args.googleMapCountry;
    if (!r)
      r = 'IL';
    return r;
  }

  lang = getLang(this.context);
  @ServerFunction({ allowed: c => c.isSignedIn() })
  static async getPhoneOptions(deliveryId: string, context?: Context) {
    let ActiveFamilyDeliveries = await (await import('../families/FamilyDeliveries')).ActiveFamilyDeliveries;
    let d = await context.for(ActiveFamilyDeliveries).findFirst(fd => fd.id.isEqualTo(deliveryId).and(fd.isAllowedForUser()));
    if (!d)
      return [];
    let Families = await (await import('../families/families')).Families;
    let family = await context.for(Families).findFirst(f => f.id.isEqualTo(d.family));
    let r: phoneOption[] = [];
    let settings = await ApplicationSettings.getAsync(context);
    for (const x of settings.getPhoneStrategy()) {
      if (x.option) {
        await x.option.build({
          family: family,
          d: d,
          context: context,

          phoneItem: x,
          settings,
          addPhone: (name, phone) => r.push({ name: name, phone: phone })
        });
      }
    }
    return r;
  }
  showVideo() {
    return this.lang.languageCode == 'iw' && !this.isSytemForMlt();
  }

  id = new NumberColumn();
  organisationName = new StringColumn(this.lang.organizationName);
  validateSmsContent(c: StringColumn) {
    return;
    if (c.value && c.value.indexOf("!אתר!") < 0 && c.value.indexOf("!URL!") < 0)
      c.validationError = this.lang.mustIncludeUrlKeyError;
  }
  smsText = new StringColumn({
    caption: this.lang.smsMessageContentCaption, validate: () => {
      this.validateSmsContent(this.smsText);

    }
  });
  reminderSmsText = new StringColumn({
    caption: this.lang.smsReminderMessageContentCaption,
    validate: () => {
      this.validateSmsContent(this.reminderSmsText);
    }
  });
  registerFamilyReplyEmailText = new StringColumn({
    caption: this.lang.emailDonorContentCaption,
    validate: () => {
      this.validateSmsContent(this.registerFamilyReplyEmailText);
    }
  });
  registerHelperReplyEmailText = new StringColumn({
    caption: this.lang.emailHelperContentCaption,
    validate: () => {
      this.validateSmsContent(this.registerHelperReplyEmailText);
    }
  });
  gmailUserName = new StringColumn({ caption: "gMail UserName", includeInApi: Roles.admin });
  gmailPassword = new StringColumn({ caption: "gMail password", includeInApi: Roles.admin });
  logoUrl = new StringColumn(this.lang.logoUrl);
  addressApiResult = new StringColumn();
  address = new AddressColumn(this.context, this.addressApiResult, this.lang.deliveryCenterAddress);
  commentForSuccessDelivery = new StringColumn(this.lang.successMessageColumnName);
  commentForSuccessLeft = new StringColumn(this.lang.leftByDoorMessageColumnName);
  commentForProblem = new StringColumn(this.lang.problemCommentColumnName);
  messageForDoneDelivery = new StringColumn(this.lang.messageForVolunteerWhenDoneCaption);

  helpText = new StringColumn(this.lang.helpName);
  helpPhone = new PhoneColumn(this.lang.helpPhone);
  phoneStrategy = new StringColumn();
  getPhoneStrategy(): PhoneItem[] {
    try {
      return JSON.parse(this.phoneStrategy.value).map(x => {
        return {
          name: x.name,
          phone: x.phone,
          option: PhoneOption[x.option]
        };
      });
    }
    catch
    {
      return [{ option: PhoneOption.assignerOrOrg }];
    }
  }
  getQuestions(): qaItem[] {
    try {
      return JSON.parse(this.commonQuestions.value);
    }
    catch
    {
      return [];
    }
  }
  commonQuestions = new StringColumn();
  dataStructureVersion = new NumberColumn({ allowApiUpdate: false });
  deliveredButtonText = new StringColumn(this.lang.successButtonSettingName);
  message1Text = new StringColumn(this.lang.freeText1ForVolunteer);
  message1Link = new StringColumn(this.lang.urlFreeText1);
  message1OnlyWhenDone = new BoolColumn(this.lang.showText1OnlyWhenDone);
  message2Text = new StringColumn(this.lang.freeText2ForVolunteer);
  message2Link = new StringColumn(this.lang.urlFreeText2);
  message2OnlyWhenDone = new BoolColumn(this.lang.showText2OnlyWhenDone);
  forWho = new TranslationOptionsColumn();
  _old_for_soliders = new BoolColumn({ dbName: 'forSoldiers' });

  usingSelfPickupModule = new BoolColumn(this.lang.enableSelfPickupModule);
  isSytemForMlt() {
    return this.forWho.value == TranslationOptions.donors;
  }

  showCompanies = new BoolColumn(this.lang.showVolunteerCompany);
  manageEscorts = new BoolColumn(this.lang.activateEscort);
  showHelperComment = new BoolColumn(this.lang.showHelperComment);
  showGroupsOnAssing = new BoolColumn(this.lang.filterFamilyGroups);
  showCityOnAssing = new BoolColumn(this.lang.filterCity);
  showAreaOnAssing = new BoolColumn(this.lang.filterRegion);
  showBasketOnAssing = new BoolColumn(this.lang.filterBasketType);
  showNumOfBoxesOnAssing = new BoolColumn(this.lang.selectNumberOfFamilies);
  showLeftThereButton = new BoolColumn(this.lang.showLeftByHouseButton);
  redTitleBar = new BoolColumn(this.lang.redTitleBar);
  defaultPrefixForExcelImport = new StringColumn(this.lang.defaultPhonePrefixForExcelImport);
  checkIfFamilyExistsInDb = new BoolColumn(this.lang.checkIfFamilyExistsInDb);
  removedFromListStrategy = new RemovedFromListExcelImportStrategyColumn(this.context);
  checkIfFamilyExistsInFile = new BoolColumn(this.lang.checkIfFamilyExistsInFile);
  excelImportAutoAddValues = new BoolColumn(this.lang.excelImportAutoAddValues);
  excelImportUpdateFamilyDefaultsBasedOnCurrentDelivery = new BoolColumn(this.lang.excelImportUpdateFamilyDefaultsBasedOnCurrentDelivery);
  checkDuplicatePhones = new BoolColumn(this.lang.checkDuplicatePhones);
  volunteerCanUpdateComment = new BoolColumn(this.lang.volunteerCanUpdateComment);
  volunteerCanUpdateDeliveryComment = new BoolColumn(this.lang.volunteerCanUpdateDeliveryComment);
  hideFamilyPhoneFromVolunteer = new BoolColumn(this.lang.hideFamilyPhoneFromVolunteer);
  static serverHasPhoneProxy = false;
  usePhoneProxy = new BoolColumn({ allowApiUpdate: false });
  showOnlyLastNamePartToVolunteer = new BoolColumn(this.lang.showOnlyLastNamePartToVolunteer);
  showTzToVolunteer = new BoolColumn(this.lang.showTzToVolunteer);
  allowSendSuccessMessageOption = new BoolColumn({ caption: this.lang.allowSendSuccessMessageOption, allowApiUpdate: false });
  sendSuccessMessageToFamily = new BoolColumn(this.lang.sendSuccessMessageToFamily);
  successMessageText = new StringColumn(this.lang.successMessageText);
  requireEULA = new BoolColumn(this.lang.requireEULA);
  requireConfidentialityApprove = new BoolColumn(this.lang.requireConfidentialityApprove);
  requireComplexPassword = new BoolColumn(this.lang.requireComplexPassword);
  timeToDisconnect = new NumberColumn(this.lang.timeToDisconnect);
  daysToForcePasswordChange = new NumberColumn(this.lang.daysToForcePasswordChange);
  showDeliverySummaryToVolunteerOnFirstSignIn = new BoolColumn(this.lang.showDeliverySummaryToVolunteerOnFirstSignIn);

  showDistCenterAsEndAddressForVolunteer = new BoolColumn(this.lang.showDistCenterAsEndAddressForVolunteer);
  routeStrategy = new routeStrategyColumn();

  BusyHelperAllowedFreq_nom = new NumberColumn(this.lang.maxDeliveriesBeforeBusy);
  BusyHelperAllowedFreq_denom = new NumberColumn(this.lang.daysCountForBusy);
  MaxItemsQuantityInDeliveryThatAnIndependentVolunteerCanSee = new NumberColumn(this.lang.MaxItemsQuantityInDeliveryThatAnIndependentVolunteerCanSee);
  MaxDeliverisQuantityThatAnIndependentVolunteerCanAssignHimself = new NumberColumn(this.lang.MaxDeliverisQuantityThatAnIndependentVolunteerCanAssignHimself);

  defaultStatusType = new DeliveryStatusColumn(this.context, {
    caption: this.lang.defaultStatusType
  }, [DeliveryStatus.ReadyForDelivery, DeliveryStatus.SelfPickup]);

  boxes1Name = new StringColumn(this.lang.boxes1NameCaption);
  boxes2Name = new StringColumn(this.lang.boxes2NameCaption);
  familyCustom1Caption = new StringColumn({ caption: this.lang.customColumn + " 1 " + this.lang.caption, includeInApi: Roles.admin });
  familyCustom1Values = new StringColumn({ caption: this.lang.customColumn + " 1 " + this.lang.optionalValues, includeInApi: Roles.admin });
  familyCustom2Caption = new StringColumn({ caption: this.lang.customColumn + " 2 " + this.lang.caption, includeInApi: Roles.admin });
  familyCustom2Values = new StringColumn({ caption: this.lang.customColumn + " 2 " + this.lang.optionalValues, includeInApi: Roles.admin });
  familyCustom3Caption = new StringColumn({ caption: this.lang.customColumn + " 3 " + this.lang.caption, includeInApi: Roles.admin });
  familyCustom3Values = new StringColumn({ caption: this.lang.customColumn + " 3 " + this.lang.optionalValues, includeInApi: Roles.admin });
  familyCustom4Caption = new StringColumn({ caption: this.lang.customColumn + " 4 " + this.lang.caption, includeInApi: Roles.admin });
  familyCustom4Values = new StringColumn({ caption: this.lang.customColumn + " 4 " + this.lang.optionalValues, includeInApi: Roles.admin });
  currentUserIsValidForAppLoadTest = new BoolColumn({ serverExpression: () => this.context.isSignedIn() });
  questionForVolunteer1Caption = new StringColumn({ caption: this.lang.questionForVolunteer + " 1 " + this.lang.caption });
  questionForVolunteer1Values = new StringColumn({ caption: this.lang.questionForVolunteer + " 1 " + this.lang.optionalValues });
  questionForVolunteer2Caption = new StringColumn({ caption: this.lang.questionForVolunteer + " 2 " + this.lang.caption });
  questionForVolunteer2Values = new StringColumn({ caption: this.lang.questionForVolunteer + " 2 " + this.lang.optionalValues });
  questionForVolunteer3Caption = new StringColumn({ caption: this.lang.questionForVolunteer + " 3 " + this.lang.caption });
  questionForVolunteer3Values = new StringColumn({ caption: this.lang.questionForVolunteer + " 3 " + this.lang.optionalValues });
  questionForVolunteer4Caption = new StringColumn({ caption: this.lang.questionForVolunteer + " 4 " + this.lang.caption });
  questionForVolunteer4Values = new StringColumn({ caption: this.lang.questionForVolunteer + " 4 " + this.lang.optionalValues });

  createBasketsForAllFamiliesInCreateEvent = new BoolColumn({ includeInApi: Roles.admin });
  includeGroupsInCreateEvent = new StringColumn({ includeInApi: Roles.admin });
  excludeGroupsInCreateEvent = new StringColumn({ includeInApi: Roles.admin });



  constructor(private context: Context) {
    super({
      name: 'ApplicationSettings',
      allowApiRead: true,
      allowApiUpdate: Roles.admin,
      saving: async () => {
        if (context.onServer) {

          await this.address.updateApiResultIfChanged();

          for (const l of [this.message1Link, this.message2Link]) {
            if (l.value) {
              if (l.value.trim().indexOf(':') < 0)
                l.value = 'http://' + l.value.trim();
            }
          }
          this.helpPhone.value = PhoneColumn.fixPhoneInput(this.helpPhone.value,context);
          if (this.forWho.value)
            setLangForSite(Sites.getValidSchemaFromContext(context), this.forWho.value);
          setSettingsForSite(Sites.getValidSchemaFromContext(context), this);
          logChanges(this, context, { excludeColumns: [this.currentUserIsValidForAppLoadTest] });
        }
      }
    })
  }

  static get(context: Context) {
    if (context.onServer) {

    }
    return context.for(ApplicationSettings).lookup(app => app.id.isEqualTo(1));

  }
  static async getAsync(context: Context): Promise<ApplicationSettings> {
    return (await context.for(ApplicationSettings).findFirst());
  }

}
export class PhoneOption {

  static assignerOrOrg = new PhoneOption("assignerOrOrg", "הטלפון ממנו יצא הSMS", async args => {
    if (args.settings.helpText.value) {
      args.addPhone(args.settings.helpText.value, args.settings.helpPhone.displayValue);
    }
    else {
      let h = await args.context.for((await import('../helpers/helpers')).Helpers).lookupAsync(args.d.courierAssignUser)
      args.addPhone(h.name.value, h.phone.displayValue);
    }
  });
  static familyHelpPhone = new PhoneOption("familyHelpPhone", "איש קשר לבירור כפי שמוגדר למשפחה", async args => {
    if (args.family.socialWorker.value && args.family.socialWorkerPhone1.value) {
      args.addPhone(args.family.socialWorker.value, args.family.socialWorkerPhone1.displayValue);
    }
    if (args.family.socialWorker.value && args.family.socialWorkerPhone2.value) {
      args.addPhone(args.family.socialWorker.value, args.family.socialWorkerPhone2.displayValue);
    }
  });
  static defaultVolunteer = new PhoneOption("defaultVolunteer", use ? use.language.defaultVolunteer : '', async args => {
    if (args.family.fixedCourier.value && args.d.courier.value != args.family.fixedCourier.value) {
      let h = await args.context.for((await import('../helpers/helpers')).Helpers).findId(args.family.fixedCourier.value);
      args.addPhone(getLang(args.context).defaultVolunteer + ": " + h.name.value, h.phone.displayValue);
    }
  });


  static familySource = new PhoneOption("familySource", "טלפון גורם מפנה", async args => {
    if (args.family.familySource.value) {
      let s = await args.context.for(FamilySources).findFirst(x => x.id.isEqualTo(args.family.familySource.value));
      if (s && s.phone.value) {
        let name = s.contactPerson.value;
        if (!name || name.length == 0) {
          name = s.name.value;
        }
        args.addPhone(name, s.phone.displayValue);
      }
    }
  });
  static otherPhone = new PhoneOption("otherPhone", "טלפון אחר", async args => {
    if (args.phoneItem.phone) {
      args.addPhone(args.phoneItem.name, PhoneColumn.formatPhone(args.phoneItem.phone));
    }
  });
  constructor(public key: string, public name: string, public build: ((args: phoneBuildArgs) => Promise<void>)) {

  }
}
export interface PhoneItem {
  option: PhoneOption;
  name?: string;
  phone?: string;
}
export interface phoneOption {
  name: string;
  phone: string;
}
export interface qaItem {
  question?: string;
  answer?: string;
}
export interface phoneBuildArgs {
  family: import('../families/families').Families,
  d: import('../families/FamilyDeliveries').FamilyDeliveries,
  context: Context,
  phoneItem: PhoneItem,
  settings: ApplicationSettings,
  addPhone: (name: string, value: string) => void
}


@Injectable()
export class SettingsService {
  constructor(private context: Context, private http: HttpClient) {

  }
  instance: ApplicationSettings;
  async init() {

    this.instance = await ApplicationSettings.getAsync(this.context);
    setSettingsForSite(Sites.getValidSchemaFromContext(this.context), this.instance);

    translationConfig.forWho = this.instance.forWho.value;
    DeliveryStatus.usingSelfPickupModule = this.instance.usingSelfPickupModule.value;
    (await import('../helpers/helpers')).Helpers.usingCompanyModule = this.instance.showCompanies.value;

    PhoneOption.assignerOrOrg.name = this.instance.lang.assignerOrOrg;
    PhoneOption.familyHelpPhone.name = this.instance.lang.familyHelpPhone;
    PhoneOption.familySource.name = this.instance.lang.familySourcePhone;
    PhoneOption.otherPhone.name = this.instance.lang.otherPhone;

    RemovedFromListExcelImportStrategy.displayAsError.caption = this.instance.lang.RemovedFromListExcelImportStrategy_displayAsError;
    RemovedFromListExcelImportStrategy.showInUpdate.caption = this.instance.lang.RemovedFromListExcelImportStrategy_showInUpdate;
    RemovedFromListExcelImportStrategy.ignore.caption = this.instance.lang.RemovedFromListExcelImportStrategy_ignore;


    BasketType.boxes1Name = this.instance.boxes1Name.value;
    BasketType.boxes2Name = this.instance.boxes2Name.value;
    setCustomColumnInfo(customColumnInfo[1], this.instance.familyCustom1Caption, this.instance.familyCustom1Values, Roles.admin);
    setCustomColumnInfo(customColumnInfo[2], this.instance.familyCustom2Caption, this.instance.familyCustom2Values, Roles.admin);
    setCustomColumnInfo(customColumnInfo[3], this.instance.familyCustom3Caption, this.instance.familyCustom3Values, Roles.admin);
    setCustomColumnInfo(customColumnInfo[4], this.instance.familyCustom4Caption, this.instance.familyCustom4Values, Roles.admin);
    setCustomColumnInfo(questionForVolunteers[1], this.instance.questionForVolunteer1Caption, this.instance.questionForVolunteer1Values, true);
    setCustomColumnInfo(questionForVolunteers[2], this.instance.questionForVolunteer2Caption, this.instance.questionForVolunteer2Values, true);
    setCustomColumnInfo(questionForVolunteers[3], this.instance.questionForVolunteer3Caption, this.instance.questionForVolunteer3Values, true);
    setCustomColumnInfo(questionForVolunteers[4], this.instance.questionForVolunteer4Caption, this.instance.questionForVolunteer4Values, true);


  }

}
export class RemovedFromListExcelImportStrategy {
  static displayAsError = new RemovedFromListExcelImportStrategy(0, 'הצג כשגיאה');
  static showInUpdate = new RemovedFromListExcelImportStrategy(1, 'הצג במשפחות לעדכון');
  static ignore = new RemovedFromListExcelImportStrategy(2, 'התעלם והוסף משפחה חדשה');
  constructor(public id: number, public caption: string) { }
}
class RemovedFromListExcelImportStrategyColumn extends ValueListColumn<RemovedFromListExcelImportStrategy>{
  constructor(context: Context) {
    super(RemovedFromListExcelImportStrategy, {
      caption: getLang(context).existsInRemovedFromListStrategy
      , dataControlSettings: () => ({
        valueList: this.getOptions(),

      })
    })
  }

}


export const customColumnInfo: customColumnInfo[] = [{}, {}, {}, {}, {}];
export const questionForVolunteers: customColumnInfo[] = [{}, {}, {}, {}, {}];
export class CustomColumn extends StringColumn {

  constructor(private info: customColumnInfo) {
    super({
      caption: info.caption,
      allowApiUpdate: info.role,
      dataControlSettings: () => ({
        valueList: info.values,
        visible: () => info.visible
      })
    });
  }
  visible = this.info.visible;
}
export function setCustomColumnInfo(v: customColumnInfo, caption: StringColumn, values: StringColumn, role: Allowed) {

  v.visible = !!caption.value;
  v.caption = caption.value;
  v.values = undefined;
  v.role = role;
  if (values.value) {
    v.values = values.value.split(',').map(x => x.trim());
  }
}
const settingsForSite = new Map<string, ApplicationSettings>();
export function setSettingsForSite(site: string, lang: ApplicationSettings) {
  settingsForSite.set(site, lang);
}
export function getSettings(context: Context) {
  let r = settingsForSite.get(Sites.getValidSchemaFromContext(context));
  if (r)
    return r;
  if (context.onServer) {
    return new ApplicationSettings(context);
    throw "can't find application settings on server for this request";
  }
  return ApplicationSettings.get(context);;
}

interface customColumnInfo {
  caption?: string,
  visible?: boolean,
  values?: string[],
  role?: Allowed
}
export function includePhoneInApi(context: Context) {
  var s = getSettings(context);
  if (!s.hideFamilyPhoneFromVolunteer.value)
    return true;
  if (context.isAllowed(Roles.distCenterAdmin))
    return true
  return false;

}