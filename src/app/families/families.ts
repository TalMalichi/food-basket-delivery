import { DeliveryStatus, DeliveryStatusColumn } from "./DeliveryStatus";
import { YesNoColumn } from "./YesNo";

import { FamilySourceId } from "./FamilySources";
import { BasketId, QuantityColumn } from "./BasketType";
import { SqlBuilder, PhoneColumn, EmailColumn, delayWhileTyping, wasChanged, changeDate } from "../model-shared/types";
import { DataControlSettings, Column, Context, EntityClass, ServerFunction, IdEntity, IdColumn, StringColumn, NumberColumn, BoolColumn, SqlDatabase, DateColumn, Filter, ColumnOptions, SpecificEntityHelper, Entity, DataArealColumnSetting } from '@remult/core';
import { BusyService, SelectValueDialogComponent } from '@remult/angular';

import { HelperIdReadonly, HelperId, Helpers } from "../helpers/helpers";

import { GeocodeInformation, GetGeoInformation, leaveOnlyNumericChars, isGpsAddress, AddressColumn, GeocodeResult } from "../shared/googleApiHelpers";
import { ApplicationSettings, CustomColumn, customColumnInfo } from "../manage/ApplicationSettings";

import * as fetch from 'node-fetch';
import { Roles } from "../auth/roles";

import { use } from "../translate";
import { FamilyStatusColumn, FamilyStatus } from "./FamilyStatus";

import { GridDialogComponent } from "../grid-dialog/grid-dialog.component";
import { DialogService } from "../select-popup/dialog";
import { InputAreaComponent } from "../select-popup/input-area/input-area.component";


import { YesNoQuestionComponent } from "../select-popup/yes-no-question/yes-no-question.component";
import { allCentersToken, findClosestDistCenter } from "../manage/distribution-centers";
import { getLang } from "../sites/sites";



var FamilyDeliveries: factoryFor<import("./FamilyDeliveries").FamilyDeliveries>;

var ActiveFamilyDeliveries: factoryFor<import("./FamilyDeliveries").ActiveFamilyDeliveries>;

export function iniFamilyDeliveriesInFamiliesCode(
  fd: factoryFor<import("./FamilyDeliveries").FamilyDeliveries>,
  activeFd: factoryFor<import("./FamilyDeliveries").ActiveFamilyDeliveries>) {
  FamilyDeliveries = fd;
  ActiveFamilyDeliveries = activeFd;
}

declare type factoryFor<T> = {
  new(...args: any[]): T;
}



@EntityClass
export class Families extends IdEntity {
  @ServerFunction({ allowed: Roles.admin })
  static async getDefaultVolunteers(context?: Context, db?: SqlDatabase) {
    var sql = new SqlBuilder();
    let f = context.for(Families).create();
    let r = await db.execute(sql.query({
      from: f,
      select: () => [f.fixedCourier, 'count (*) as count'],
      where: () => [f.status.isEqualTo(FamilyStatus.Active)],
      groupBy: () => [f.fixedCourier],
      orderBy: [{ column: f.fixedCourier, descending: false }]

    }));
    let result = r.rows.map(x => ({
      id: x.fixedcourier,
      name: '',
      count: x.count
    }));
    for (const r of result) {
      let h = await context.for(Helpers).findId(r.id);
      if (h)
        r.name = h.name.value;
    }
    return result;
  }
  async showFamilyDialog(tools?: { onSave?: () => Promise<void>, focusOnAddress?: boolean }) {
    this.context.openDialog((await import("../update-family-dialog/update-family-dialog.component")).UpdateFamilyDialogComponent, x => x.args = {
      family: this,
      focusOnAddress: tools && tools.focusOnAddress,
      onSave: async () => {
        if (tools && tools.onSave)
          await tools.onSave();
      }
    });
  }
  async showDeliveryHistoryDialog(args: { dialog: DialogService, settings: ApplicationSettings, busy: BusyService }) {
    let gridDialogSettings = await this.deliveriesGridSettings(args);
    this.context.openDialog(GridDialogComponent, x => x.args = {
      title: getLang(this.context).deliveriesFor + ' ' + this.name.value,
      stateName: 'deliveries-for-family',
      settings: gridDialogSettings,
      buttons: [{
        text: use.language.newDelivery,

        click: () => this.showNewDeliveryDialog(args.dialog, args.settings, args.busy, { doNotCheckIfHasExistingDeliveries: true })
      }]
    });
  }
  public async deliveriesGridSettings(args: { dialog: DialogService, settings: ApplicationSettings, busy: BusyService }) {
    let result = this.context.for(FamilyDeliveries).gridSettings({
      numOfColumnsInGrid: 7,

      rowCssClass: fd => fd.deliverStatus.getCss(),
      gridButtons: [{
        name: use.language.newDelivery,
        icon: 'add_shopping_cart',
        click: () => this.showNewDeliveryDialog(args.dialog, args.settings, args.busy, { doNotCheckIfHasExistingDeliveries: true })
      }],
      rowButtons: [
        {
          name: use.language.deliveryDetails,
          click: async fd => fd.showDeliveryOnlyDetail({
            dialog: args.dialog,
            refreshDeliveryStats: () => result.reloadData()
          })
        },
        ...(await import("../family-deliveries/family-deliveries.component")).getDeliveryGridButtons({
          context: this.context,
          refresh: () => result.reloadData(),
          deliveries: () => result,
          dialog: args.dialog,
          settings: args.settings,
          busy: args.busy

        })
      ],
      columnSettings: fd => {
        let r: Column[] = [
          fd.deliverStatus,
          fd.deliveryStatusDate,
          fd.basketType,
          fd.quantity,
          fd.courier,
          fd.deliveryComments,
          fd.courierComments,
          fd.internalDeliveryComment,
          fd.distributionCenter
        ];
        r.push(...fd.columns.toArray().filter(c => !r.includes(c) && c != fd.id && c != fd.familySource).sort((a, b) => a.defs.caption.localeCompare(b.defs.caption)));
        return r;
      },

      where: fd => fd.family.isEqualTo(this.id),
      orderBy: fd => [{ column: fd.deliveryStatusDate, descending: true }],
      rowsInPage: 25

    });
    return result;
  }

  async showNewDeliveryDialog(dialog: DialogService, settings: ApplicationSettings, busy: BusyService, args?: {
    copyFrom?: import("./FamilyDeliveries").FamilyDeliveries,
    aDeliveryWasAdded?: (newDeliveryId: string) => Promise<void>,
    doNotCheckIfHasExistingDeliveries?: boolean
  }) {
    if (!args)
      args = {};
    if (!args.doNotCheckIfHasExistingDeliveries) {
      let hasExisting = await this.context.for(ActiveFamilyDeliveries).count(d => d.family.isEqualTo(this.id).and(d.deliverStatus.isNotAResultStatus()));
      if (hasExisting > 0) {
        if (await dialog.YesNoPromise(settings.lang.familyHasExistingDeliveriesDoYouWantToViewThem)) {
          this.showDeliveryHistoryDialog({ dialog, settings, busy });
          return;
        }
      }
    }

    let newDelivery = this.createDelivery(await dialog.getDistCenter(this.address.location()));
    let arciveCurrentDelivery = new BoolColumn({ caption: getLang(this.context).archiveCurrentDelivery, defaultValue: true });
    if (args.copyFrom != undefined) {
      newDelivery.copyFrom(args.copyFrom);

    }
    let selfPickup = new BoolColumn({ caption: getLang(this.context).familySelfPickup, defaultValue: this.defaultSelfPickup.value });
    if (args.copyFrom) {
      selfPickup.value = args.copyFrom.deliverStatus.value == DeliveryStatus.SuccessPickedUp;
      if (args.copyFrom.deliverStatus.value.isProblem)
        newDelivery.courier.value = '';
    }


    await this.context.openDialog(InputAreaComponent, x => {
      x.args = {
        settings: {
          columnSettings: () => {
            let r: DataArealColumnSetting<any>[] = [
              [newDelivery.basketType,
              newDelivery.quantity],
              newDelivery.deliveryComments];
            if (dialog.hasManyCenters)
              r.push(newDelivery.distributionCenter);
            r.push(newDelivery.courier);
            if (args.copyFrom != null && DeliveryStatus.IsAResultStatus(args.copyFrom.deliverStatus.value)) {
              r.push(arciveCurrentDelivery);
            }
            r.push({ column: selfPickup, visible: () => settings.usingSelfPickupModule.value })

            return r;
          }
        },
        title: getLang(this.context).newDeliveryFor + this.name.value,
        validate: async () => {
          let count = await newDelivery.duplicateCount();
          if (count > 0) {
            if (await dialog.YesNoPromise(getLang(this.context).familyAlreadyHasAnActiveDelivery)) {
              return;
            }
            else {
              throw getLang(this.context).notOk;
            }
          }
        },
        ok: async () => {
          let newId = await Families.addDelivery(newDelivery.family.value, {
            basketType: newDelivery.basketType.value,
            quantity: newDelivery.quantity.value,
            comment: newDelivery.deliveryComments.value,
            courier: newDelivery.courier.value,
            distCenter: newDelivery.distributionCenter.value,
            selfPickup: selfPickup.value

          });
          if (args.copyFrom != null && DeliveryStatus.IsAResultStatus(args.copyFrom.deliverStatus.value) && arciveCurrentDelivery.value) {
            args.copyFrom.archive.value = true;
            await args.copyFrom.save();
          }
          if (args.aDeliveryWasAdded)
            await args.aDeliveryWasAdded(newId);
          dialog.Info(getLang(this.context).deliveryCreatedSuccesfully);
        }
        , cancel: () => { }

      }
    });
  }
  @ServerFunction({ allowed: Roles.admin })
  static async addDelivery(familyId: string, settings: {
    basketType: string,
    quantity: number,
    comment: string,
    distCenter: string,
    courier: string,
    selfPickup: boolean,
    deliverStatus?: DeliveryStatus,
    archive?: boolean
  }, context?: Context) {
    let f = await context.for(Families).findId(familyId);
    if (f) {
      if (settings.distCenter == allCentersToken)
        settings.distCenter = await findClosestDistCenter(f.address.location(), context);
      let fd = f.createDelivery(settings.distCenter);
      fd.basketType.value = settings.basketType;
      fd.quantity.value = settings.quantity;
      fd.deliveryComments.value = settings.comment;
      fd.distributionCenter.value = settings.distCenter;
      fd.courier.value = settings.courier;
      if (settings.deliverStatus) fd.deliverStatus.value = settings.deliverStatus;
      if (settings.archive) fd.archive.value = settings.archive;
      if (settings.selfPickup)
        fd.deliverStatus.value = DeliveryStatus.SelfPickup;

      await fd.save();
      return fd.id.value;
    }
    throw getLang(context).familyWasNotFound;

  }
  createDelivery(distCenter: string) {
    let fd = this.context.for(FamilyDeliveries).create();
    fd.family.value = this.id.value;
    fd.distributionCenter.value = distCenter;
    fd.special.value = this.special.value;
    fd.basketType.value = this.basketType.value;
    fd.quantity.value = this.quantity.value;
    fd.deliveryComments.value = this.deliveryComments.value;
    fd.courier.value = this.fixedCourier.value;
    fd.deliverStatus.value = this.defaultSelfPickup.value ? DeliveryStatus.SelfPickup : DeliveryStatus.ReadyForDelivery;
    this.updateDelivery(fd);
    return fd;
  }
  sharedColumns() {
    return [
      this.name,
      this.familySource,
      this.groups,
      this.address,
      this.floor,
      this.appartment,
      this.entrance,
      this.city,
      this.area,
      this.addressComment,
      this.addressLongitude,
      this.addressLatitude,
      this.drivingLongitude,
      this.drivingLatitude,
      this.addressByGoogle,
      this.addressOk,
      this.phone1,
      this.phone1Description,
      this.phone2,
      this.phone2Description,
      this.phone3,
      this.phone3Description,
      this.phone4,
      this.phone4Description,
      this.fixedCourier,
      this.familyMembers
    ];
  }
  isGpsAddress() {
    return isGpsAddress(this.address.value);
  }
  getAddressDescription() {
    if (this.isGpsAddress()) {
      return getLang(this.context).gpsLocationNear + ' ' + this.addressByGoogle.value;

    }
    return this.address.value;
  }
  updateDelivery(fd: import("./FamilyDeliveries").FamilyDeliveries) {
    fd.family.value = this.id.value;
    for (const col of this.sharedColumns()) {
      fd.columns.find(col).value = col.value;
    }
  }

  __disableGeocoding = false;

  constructor(private context: Context) {
    super(
      {
        name: "Families",
        caption: getLang(context).deliveries,
        allowApiRead: Roles.admin,
        allowApiUpdate: Roles.admin,
        allowApiDelete: false,
        allowApiInsert: Roles.admin,
        apiDataFilter: () => {
          if (!context.isAllowed(Roles.admin)) {
            if (context.isAllowed(Roles.admin))
              return undefined;
            return this.id.isEqualTo('no rows');
          }
        },
        saving: async () => {
          if (this.disableOnSavingRow)
            return;
          if (this.context.onServer) {
            if (!this.quantity.value || this.quantity.value < 1)
              this.quantity.value = 1;
            if (wasChanged(this.area) && this.area.value)
              this.area.value = this.area.value.trim();



            if (this.address.value != this.address.originalValue || !this.address.ok() || this.autoCompleteResult.value) {
              await this.reloadGeoCoding();
            }
            if (this.isNew()) {
              this.createDate.value = new Date();
              this.createUser.value = context.user.id;
            }
            if (this.status.value != this.status.originalValue) {
              this.statusDate.value = new Date();
              this.statusUser.value = context.user.id;
            }

            if (!this._suppressLastUpdateDuringSchemaInit) {
              this.lastUpdateDate.value = new Date();
              this.lastUpdateUser.value = context.user.id;
            }



            if (this.sharedColumns().find(x => x.value != x.originalValue) || [this.basketType, this.quantity, this.deliveryComments, this.defaultSelfPickup].find(x => wasChanged(x))) {
              for await (const fd of await context.for(FamilyDeliveries).find({
                where: fd =>
                  fd.family.isEqualTo(this.id).and(
                    fd.archive.isEqualTo(false).and(
                      fd.deliverStatus.isGreaterOrEqualTo(DeliveryStatus.ReadyForDelivery).and(
                        fd.deliverStatus.isLessOrEqualTo(DeliveryStatus.Frozen)
                      )))
              })) {
                this.updateDelivery(fd);
                if (wasChanged(this.basketType) && fd.basketType.value == this.basketType.originalValue)
                  fd.basketType.value = this.basketType.value;
                if (wasChanged(this.quantity) && fd.quantity.value == this.quantity.originalValue)
                  fd.quantity.value = this.quantity.value;
                if (wasChanged(this.deliveryComments) && fd.deliveryComments.value == this.deliveryComments.originalValue)
                  fd.deliveryComments.value = this.deliveryComments.value;
                if (wasChanged(this.fixedCourier) && fd.courier.value == this.fixedCourier.originalValue)
                  fd.courier.value = this.fixedCourier.value;
                if (wasChanged(this.defaultSelfPickup))
                  if (this.defaultSelfPickup.value)
                    if (fd.deliverStatus.value == DeliveryStatus.ReadyForDelivery)
                      fd.deliverStatus.value = DeliveryStatus.SelfPickup;
                    else if (fd.deliverStatus.value == DeliveryStatus.SelfPickup)
                      fd.deliverStatus.value = DeliveryStatus.ReadyForDelivery;
                await fd.save();
              }
            }

          }
          else if (!this.context.onServer) {
            let statusChangedOutOfActive = wasChanged(this.status) && this.status.value != FamilyStatus.Active;
            if (statusChangedOutOfActive) {
              let activeDeliveries = this.context.for(ActiveFamilyDeliveries).iterate({ where: fd => fd.family.isEqualTo(this.id).and(fd.deliverStatus.isNotAResultStatus()) });
              if (await activeDeliveries.count() > 0) {
                if (await this.context.openDialog(YesNoQuestionComponent, async x => x.args = {
                  question: getLang(this.context).thisFamilyHas + " " + (await activeDeliveries.count()) + " " + getLang(this.context).deliveries_ShouldWeDeleteThem
                }, y => y.yes)) {
                  for await (const d of activeDeliveries) {
                    await d.delete();

                  }
                }
              }
            }
          }
        }

      });
    this.id.defs.caption = getLang(this.context).familyIdInHagaiApp;
  }
  disableChangeLogging = false;
  disableOnSavingRow = false;
  _suppressLastUpdateDuringSchemaInit = false;


  name = new StringColumn({
    caption: getLang(this.context).familyName,
    valueChange: () => this.delayCheckDuplicateFamilies(),
    validate: () => {
      if (!this.name.value)
        this.name.validationError = getLang(this.context).nameIsTooShort;
    }
  });

  tz = new StringColumn({
    caption: getLang(this.context).socialSecurityNumber, valueChange: () => this.delayCheckDuplicateFamilies()
  });
  tz2 = new StringColumn({
    caption: getLang(this.context).spouceSocialSecurityNumber, valueChange: () => this.delayCheckDuplicateFamilies()
  });
  familyMembers = new NumberColumn({ caption: getLang(this.context).familyMembers });
  birthDate = new DateColumn({ caption: getLang(this.context).birthDate });
  nextBirthday = new DateColumn({

    caption: getLang(this.context).nextBirthDay,
    sqlExpression: () => "(select cast(birthDate + ((extract(year from age(birthDate)) + 1) * interval '1' year) as date) as nextBirthday)",
    allowApiUpdate: false,
    dataControlSettings: () => ({
      readOnly: true,
      inputType: 'date',
      getValue: () => {
        if (!this.nextBirthday.value)
          return;
        return this.nextBirthday.displayValue + " - " + getLang(this.context).age + " " + (this.nextBirthday.value.getFullYear() - this.birthDate.value.getFullYear())
      }
    })

  })
  basketType = new BasketId(this.context, getLang(this.context).defaultBasketType);
  quantity = new QuantityColumn(this.context, { caption: getLang(this.context).defaultQuantity, allowApiUpdate: Roles.admin });

  familySource = new FamilySourceId(this.context, { includeInApi: true, caption: getLang(this.context).familySource });
  socialWorker = new StringColumn(getLang(this.context).familyHelpContact);
  socialWorkerPhone1 = new PhoneColumn(getLang(this.context).familyHelpPhone1);
  socialWorkerPhone2 = new PhoneColumn(getLang(this.context).familyHelpPhone2);
  groups = new GroupsColumn(this.context);
  special = new YesNoColumn({ caption: getLang(this.context).specialAsignment });
  defaultSelfPickup = new BoolColumn(getLang(this.context).defaultSelfPickup);
  iDinExcel = new StringColumn({ caption: getLang(this.context).familyUniqueId });
  internalComment = new StringColumn({ caption: getLang(this.context).internalComment });


  addressApiResult = new StringColumn();
  address = new AddressColumn(this.context, this.addressApiResult, getLang(this.context).address, {
    valueChange: () => {
      if (!this.address.value)
        return;
      let y = parseUrlInAddress(this.address.value);
      if (y != this.address.value)
        this.address.value = y;
    }
  });

  floor = new StringColumn(getLang(this.context).floor);
  appartment = new StringColumn(getLang(this.context).appartment);
  entrance = new StringColumn(getLang(this.context).entrance);
  city = new StringColumn({ caption: getLang(this.context).cityAutomaticallyUpdatedByGoogle });
  area = new AreaColumn(this.context);
  addressComment = new StringColumn(getLang(this.context).addressComment);
  postalCode = new NumberColumn(getLang(this.context).postalCode);
  deliveryComments = new StringColumn(getLang(this.context).defaultDeliveryComment);

  phone1 = new PhoneColumn({ caption: getLang(this.context).phone1, dbName: 'phone', valueChange: () => this.delayCheckDuplicateFamilies() });
  phone1Description = new StringColumn(getLang(this.context).phone1Description);
  phone2 = new PhoneColumn({ caption: getLang(this.context).phone2, valueChange: () => this.delayCheckDuplicateFamilies() });
  phone2Description = new StringColumn(getLang(this.context).phone2Description);
  phone3 = new PhoneColumn({ caption: getLang(this.context).phone3, valueChange: () => this.delayCheckDuplicateFamilies() });
  phone3Description = new StringColumn(getLang(this.context).phone3Description);
  phone4 = new PhoneColumn({ caption: getLang(this.context).phone4, valueChange: () => this.delayCheckDuplicateFamilies() });
  phone4Description = new StringColumn(getLang(this.context).phone4Description);

  email = new EmailColumn();

  status = new FamilyStatusColumn(this.context);
  statusDate = new changeDate(getLang(this.context).statusChangeDate);
  statusUser = new HelperIdReadonly(this.context, getLang(this.context).statusChangeUser);
  fixedCourier = new HelperId(this.context, getLang(this.context).defaultVolunteer, { location: () => this.address.location(), searchClosestDefaultFamily: true });
  custom1 = new CustomColumn(customColumnInfo[1]);
  custom2 = new CustomColumn(customColumnInfo[2]);
  custom3 = new CustomColumn(customColumnInfo[3]);
  custom4 = new CustomColumn(customColumnInfo[4]);

  async reloadGeoCoding() {

    let geo: GeocodeInformation;

    if (this.autoCompleteResult.value) {
      let result: autocompleteResult = JSON.parse(this.autoCompleteResult.value);
      if (result.address == this.address.value)
        geo = new GeocodeInformation(result.result);
    }
    if (geo == undefined && !this.__disableGeocoding)
      geo = await GetGeoInformation(this.address.value, this.context);
    if (geo == undefined) {
      geo = new GeocodeInformation();
    }
    this.addressApiResult.value = geo.saveToString();
    this.city.value = '';
    if (geo.ok()) {
      this.city.value = geo.getCity();
      await this.setPostalCodeServerOnly();
    }
    this.addressOk.value = !geo.partialMatch();
    this.addressByGoogle.value = geo.getAddress();
    this.addressLongitude.value = geo.location().lng;
    this.addressLatitude.value = geo.location().lat;
    this.drivingLatitude.value = this.addressLatitude.value;
    this.drivingLongitude.value = this.addressLongitude.value;
    if (isGpsAddress(this.address.value)) {
      var j = this.address.value.split(',');
      this.addressLatitude.value = +j[0];
      this.addressLongitude.value = +j[1];
    }
  }

  async setPostalCodeServerOnly() {
    if (!process.env.AUTO_POSTAL_CODE)
      return;
    var geo = this.address.getGeocodeInformation();
    var house = '';
    var streen = '';
    var location = '';
    for (const c of geo.info.results[0].address_components) {
      switch (c.types[0]) {
        case "street_number":
          house = c.long_name;
          break;
        case "route":
          streen = c.long_name;
          break;
        case "locality":
          location = c.long_name;
          break;
      }
    }
    try {
      let r = await (await fetch.default('https://www.zipy.co.il/findzip', {
        method: 'post',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: 'location=' + encodeURI(location) + '&street=' + encodeURI(streen) + '&house=' + encodeURI(house) + '&entrance=&pob='
      })).json();
      if (r.errors == 0 && r.zip) {
        this.postalCode.value = +r.zip;
      }
    }
    catch (err) {
      console.log(err);
    }
  }


  previousDeliveryStatus = new DeliveryStatusColumn(this.context, {
    caption: getLang(this.context).previousDeliveryStatus,
    sqlExpression: () => {
      return this.dbNameFromLastDelivery(fde => fde.deliverStatus, "prevStatus");
    }
  });
  previousDeliveryDate = new changeDate({
    caption: getLang(this.context).previousDeliveryDate,

    sqlExpression: () => {
      return this.dbNameFromLastDelivery(fde => fde.deliveryStatusDate, "prevDate");
    }
  });
  previousDeliveryComment = new StringColumn({
    caption: getLang(this.context).previousDeliveryNotes,
    sqlExpression: () => {
      return this.dbNameFromLastDelivery(fde => fde.courierComments, "prevComment");
    }
  });

  numOfActiveReadyDeliveries = new NumberColumn({
    caption: getLang(this.context).numOfActiveReadyDeliveries,
    sqlExpression: () => {
      let fd = this.context.for(FamilyDeliveries).create();
      let sql = new SqlBuilder();
      return sql.columnCount(this, {
        from: fd,
        where: () => [sql.eq(fd.family, this.id),
        fd.archive.isEqualTo(false).and(fd.deliverStatus.isNotAResultStatus())]
      });

    }
  });



  //שים לב - אם המשתמש הקליד כתובת GPS בכתובת - אז הנקודה הזו תהיה הנקודה שהמשתמש הקליד ולא מה שגוגל מצא
  addressLongitude = new NumberColumn({ decimalDigits: 8 });
  addressLatitude = new NumberColumn({ decimalDigits: 8 });
  //זו התוצאה שחזרה מהGEOCODING כך שהיא מכוונת לכביש הקרוב
  drivingLongitude = new NumberColumn({ decimalDigits: 8 });
  drivingLatitude = new NumberColumn({ decimalDigits: 8 });
  addressByGoogle = new StringColumn({ caption: getLang(this.context).addressByGoogle, allowApiUpdate: false });
  autoCompleteResult = new StringColumn({ serverExpression: () => '' });
  addressOk = new BoolColumn({ caption: getLang(this.context).addressOk });

  private dbNameFromLastDelivery(col: (fd: import("./FamilyDeliveries").FamilyDeliveries) => Column, alias: string) {

    let fd = this.context.for(FamilyDeliveries).create();
    let sql = new SqlBuilder();
    return sql.columnInnerSelect(this, {
      select: () => [sql.columnWithAlias(col(fd), alias)],
      from: fd,

      where: () => [sql.eq(fd.family, this.id),
      ],
      orderBy: [{ column: fd.deliveryStatusDate, descending: true }]
    });
  }



  getPreviousDeliveryColumn() {
    return {
      caption: getLang(this.context).previousDeliverySummary,
      readonly: true,
      column: this.previousDeliveryStatus,
      dropDown: {
        items: this.previousDeliveryStatus.getOptions()
      },
      getValue: f => {
        if (!f.previousDeliveryStatus.value)
          return '';
        let r = f.previousDeliveryStatus.displayValue;
        if (f.previousDeliveryComment.value) {
          r += ': ' + f.previousDeliveryComment.value
        }
        return r;
      },
      cssClass: f => f.previousDeliveryStatus.getCss()


    } as DataControlSettings<Families>;
  }





  createDate = new changeDate({ caption: getLang(this.context).createDate });
  createUser = new HelperIdReadonly(this.context, { caption: getLang(this.context).createUser });
  lastUpdateDate = new changeDate({ caption: getLang(this.context).lastUpdateDate });
  lastUpdateUser = new HelperIdReadonly(this.context, { caption: getLang(this.context).lastUpdateUser });




  openWaze() {
    //window.open('https://waze.com/ul?ll=' + this.getGeocodeInformation().getlonglat() + "&q=" + encodeURI(this.address.value) + 'export &navigate=yes', '_blank');
    window.open('waze://?ll=' + this.address.getGeocodeInformation().getlonglat() + "&q=" + encodeURI(this.address.value) + '&navigate=yes');
  }
  openGoogleMaps() {
    window.open('https://www.google.com/maps/search/?api=1&hl=' + getLang(this.context).languageCode + '&query=' + this.address.value, '_blank');
  }
  showOnGoogleMaps() {
    window.open('https://maps.google.com/maps?q=' + this.address.getGeocodeInformation().getlonglat() + '&hl=' + getLang(this.context).languageCode, '_blank');
  }
  showOnGovMap() {
    window.open('https://www.govmap.gov.il/?q=' + this.address.value + '&z=10', '_blank');
  }





  static SendMessageToBrowsers = (s: string, context: Context, distCenter: string) => { };
  static GetUpdateMessage(n: FamilyUpdateInfo, updateType: number, courierName: string, context: Context) {
    switch (updateType) {
      case 1:
        switch (n.deliverStatus.value) {
          case DeliveryStatus.ReadyForDelivery:
            break;
          case DeliveryStatus.Success:
          case DeliveryStatus.SuccessLeftThere:
          case DeliveryStatus.FailedBadAddress:
          case DeliveryStatus.FailedNotHome:
          case DeliveryStatus.FailedDoNotWant:
          case DeliveryStatus.FailedNotReady:
          case DeliveryStatus.FailedTooFar:
          case DeliveryStatus.FailedOther:
            let duration = '';
            if (n.courierAssingTime.value && n.deliveryStatusDate.value)
              duration = ' ' + getLang(context).within + ' ' + Math.round((n.deliveryStatusDate.value.valueOf() - n.courierAssingTime.value.valueOf()) / 60000) + " " + getLang(context).minutes;
            return n.deliverStatus.displayValue + (n.courierComments.value ? ", \"" + n.courierComments.value + "\" - " : '') + ' ' + getLang(context).forFamily + ' ' + n.name.value + ' ' + (courierName ? (getLang(context).by + ' ' + courierName) : '') + duration + "!";
        }
        return getLang(context).theFamily + ' ' + n.name.value + ' ' + getLang(context).wasUpdatedTo + ' ' + n.deliverStatus.displayValue;
      case 2:
        if (n.courier.value)
          return getLang(context).theFamily + ' ' + n.name.value + ' ' + getLang(context).wasAssignedTo + ' ' + courierName;
        else
          return getLang(context).assignmentCanceledFor + " " + n.name.value;
    }
    return n.deliverStatus.displayValue;
  }
  tzDelay: delayWhileTyping;
  private delayCheckDuplicateFamilies() {
    if (this._disableAutoDuplicateCheck)
      return;
    if (this.context.onServer)
      return;
    if (!this.tzDelay)
      this.tzDelay = new delayWhileTyping(1000);
    this.tzDelay.do(async () => {
      this.checkDuplicateFamilies();

    });

  }
  _disableAutoDuplicateCheck = false;
  duplicateFamilies: duplicateFamilyInfo[] = [];

  async checkDuplicateFamilies() {
    this.duplicateFamilies = await Families.checkDuplicateFamilies(this.name.value, this.tz.value, this.tz2.value, this.phone1.value, this.phone2.value, this.phone3.value, this.phone4.value, this.id.value, false, this.address.value);
    this.tz.validationError = undefined;
    this.tz2.validationError = undefined;
    this.phone1.validationError = undefined;
    this.phone2.validationError = undefined;
    this.phone3.validationError = undefined;
    this.phone4.validationError = undefined;
    this.name.validationError = undefined;
    let foundExactName = false;
    for (const d of this.duplicateFamilies) {
      let errorText = getLang(this.context).valueAlreadyExistsFor + ' "' + d.name + '" ' + getLang(this.context).atAddress + ' ' + d.address;
      if (d.tz)
        this.tz.validationError = errorText;
      if (d.tz2)
        this.tz2.validationError = errorText;
      if (d.phone1)
        this.phone1.validationError = errorText;
      if (d.phone2)
        this.phone2.validationError = errorText;
      if (d.phone3)
        this.phone3.validationError = errorText;
      if (d.phone4)
        this.phone4.validationError = errorText;
      if (d.nameDup && this.name.value != this.name.originalValue) {
        if (!foundExactName)
          this.name.validationError = errorText;
        if (this.name.value && d.name && this.name.value.trim() == d.name.trim())
          foundExactName = true;
      }
    }
    PhoneColumn.validatePhone(this.phone1, this.context);
    PhoneColumn.validatePhone(this.phone2, this.context);
    PhoneColumn.validatePhone(this.phone3, this.context);
    PhoneColumn.validatePhone(this.phone4, this.context);


  }
  @ServerFunction({ allowed: Roles.admin, blockUser: false })
  static async checkDuplicateFamilies(name: string, tz: string, tz2: string, phone1: string, phone2: string, phone3: string, phone4: string, id: string, exactName: boolean = false, address: string, context?: Context, db?: SqlDatabase) {
    let result: duplicateFamilyInfo[] = [];

    var sql = new SqlBuilder();
    var f = context.for(Families).create();

    let compareAsNumber = (col: Column<string>, value: string) => {
      return sql.and(sql.eq(sql.extractNumber(col), sql.extractNumber(sql.str(value))), sql.build(sql.extractNumber(sql.str(value)), ' <> ', 0));
    };
    let tzCol = sql.or(compareAsNumber(f.tz, tz), compareAsNumber(f.tz2, tz));
    let tz2Col = sql.or(compareAsNumber(f.tz, tz2), compareAsNumber(f.tz2, tz2));
    let phone1Col = sql.or(compareAsNumber(f.phone1, phone1), compareAsNumber(f.phone2, phone1), compareAsNumber(f.phone3, phone1), compareAsNumber(f.phone4, phone1));
    let phone2Col = sql.or(compareAsNumber(f.phone1, phone2), compareAsNumber(f.phone2, phone2), compareAsNumber(f.phone3, phone2), compareAsNumber(f.phone4, phone2));
    let phone3Col = sql.or(compareAsNumber(f.phone1, phone3), compareAsNumber(f.phone2, phone3), compareAsNumber(f.phone3, phone3), compareAsNumber(f.phone4, phone3));
    let phone4Col = sql.or(compareAsNumber(f.phone1, phone4), compareAsNumber(f.phone2, phone4), compareAsNumber(f.phone3, phone4), compareAsNumber(f.phone4, phone4));
    let nameCol = 'false';
    if (name && name.trim().length > 0)
      if (exactName)
        nameCol = sql.build('trim(', f.name, ') =  ', sql.str(name.trim()));
      else
        nameCol = sql.build('trim(', f.name, ') like  ', sql.str('%' + name.trim() + '%'));


    let sqlResult = await db.execute(sql.query({
      select: () => [f.id,
      f.name,
      f.address,
      sql.columnWithAlias(tzCol, 'tz'),
      sql.columnWithAlias(tz2Col, 'tz2'),
      sql.columnWithAlias(phone1Col, 'phone1'),
      sql.columnWithAlias(phone2Col, 'phone2'),
      sql.columnWithAlias(phone3Col, 'phone3'),
      sql.columnWithAlias(phone4Col, 'phone4'),
      sql.columnWithAlias(nameCol, 'nameDup'),
      sql.columnWithAlias(f.status, 'status')

      ],

      from: f,
      where: () => [sql.or(tzCol, tz2Col, phone1Col, phone2Col, phone3Col, phone4Col, nameCol), sql.ne(f.id, sql.str(id)), f.status.isDifferentFrom(FamilyStatus.ToDelete)]
    }));
    if (!sqlResult.rows || sqlResult.rows.length < 1)
      return [];

    for (const row of sqlResult.rows) {
      result.push({
        id: row[sqlResult.getColumnKeyInResultForIndexInSelect(0)],
        name: row[sqlResult.getColumnKeyInResultForIndexInSelect(1)],
        address: row[sqlResult.getColumnKeyInResultForIndexInSelect(2)],
        tz: row[sqlResult.getColumnKeyInResultForIndexInSelect(3)],
        tz2: row[sqlResult.getColumnKeyInResultForIndexInSelect(4)],
        phone1: row[sqlResult.getColumnKeyInResultForIndexInSelect(5)],
        phone2: row[sqlResult.getColumnKeyInResultForIndexInSelect(6)],
        phone3: row[sqlResult.getColumnKeyInResultForIndexInSelect(7)],
        phone4: row[sqlResult.getColumnKeyInResultForIndexInSelect(8)],
        nameDup: row[sqlResult.getColumnKeyInResultForIndexInSelect(9)],
        removedFromList: row['status'] == FamilyStatus.RemovedFromList.id,
        sameAddress: address == row[sqlResult.getColumnKeyInResultForIndexInSelect(2)],
        rank: 0

      });
    }
    for (const r of result) {
      for (const key in r) {
        if (r.hasOwnProperty(key)) {
          const element = r[key];
          if (element === true) {
            r.rank++;
          }
        }
      }
    }
    result.sort((a, b) => b.rank - a.rank);
    return result;

  }
}


export class FamilyId extends IdColumn {
  constructor(context: Context, settingsOrCaption?: ColumnOptions<string>) {
    super(settingsOrCaption);
    if (!this.defs.caption)
      this.defs.caption = getLang(context).familyIdInHagaiApp
  }
}

export interface duplicateFamilyInfo {
  id: string;
  name: string;
  address: string;
  sameAddress: boolean;
  tz: boolean;
  tz2: boolean;
  phone1: boolean;
  phone2: boolean;
  phone3: boolean;
  phone4: boolean;
  nameDup: boolean;
  removedFromList: boolean;
  rank: number;
}

export interface FamilyUpdateInfo {
  name: StringColumn,
  courier: HelperId,
  deliverStatus: DeliveryStatusColumn,
  courierAssingTime: changeDate,
  deliveryStatusDate: changeDate,
  courierComments: StringColumn
}

export function parseAddress(s: string) {
  let r = {

  } as parseAddressResult;


  let extractSomething = (what: string) => {
    let i = s.indexOf(what);
    if (i >= 0) {
      let value = '';
      let index = 0;
      for (index = i + what.length; index < s.length; index++) {
        const element = s[index];
        if (element != ' ' && element != ',') {
          value += element;
        }
        else if (value) {

          break;
        }
      }
      let after = s.substring(index + 1, 1000);
      if (s[index] == ' ')
        after = ' ' + after;
      if (s[index] == ',')
        after = ',' + after;
      s = s.substring(0, i) + after;
      return value.trim();
    }
  }
  r.dira = extractSomething('דירה');
  if (!r.dira) {
    r.dira = extractSomething('/');
  }
  r.floor = extractSomething('קומה');
  r.knisa = extractSomething('כניסה');


  r.address = s.trim();
  return r;
}
export interface parseAddressResult {
  address: string;
  dira?: string;
  floor?: string;
  knisa?: string;
}
export class AreaColumn extends StringColumn {
  constructor(context: Context, settingsOrCaption?: ColumnOptions<string>) {
    super({
      dataControlSettings: () => ({
        click: async () => {
          let areas = await AreaColumn.getAreas();
          await context.openDialog(SelectValueDialogComponent, x => x.args({
            values: areas.map(x => ({ caption: x.area })),
            onSelect: area => {
              this.value = area.caption;
            }
          }))
        }
      })
    }, settingsOrCaption);
    if (!this.defs.caption)
      this.defs.caption = getLang(context).region;
  }
  @ServerFunction({ allowed: Roles.admin })
  static async getAreas(context?: Context, db?: SqlDatabase): Promise<{ area: string, count: number }[]> {
    var sql = new SqlBuilder();
    let f = context.for(Families).create();
    let r = await db.execute(sql.query({
      from: f,
      select: () => [f.area, 'count (*) as count'],
      where: () => [f.status.isEqualTo(FamilyStatus.Active)],
      groupBy: () => [f.area],
      orderBy: [{ column: f.area, descending: false }]

    }));
    return r.rows.map(x => ({
      area: x.area,
      count: x.count
    }));
  }
}
export class GroupsColumn extends StringColumn {
  listGroups() {
    if (!this.value)
      return [];
    return this.value.split(',');
  }
  removeGroup(group: string) {
    let groups = this.value.split(",").map(x => x.trim());
    let index = groups.indexOf(group);
    if (index >= 0) {
      groups.splice(index, 1);
      this.value = groups.join(", ");
    }
  }
  addGroup(group: string) {
    if (this.value)
      this.value += ', ';
    else
      this.value = '';
    this.value += group;
  }
  constructor(private context: Context, settingsOrCaption?: ColumnOptions<string>) {
    super({
      caption: getLang(context).familyGroup,

      dataControlSettings: () => ({
        width: '300',

        forceEqualFilter: false,
        click: async () => {
          this.context.openDialog((await import('../update-group-dialog/update-group-dialog.component')).UpdateGroupDialogComponent, s => {
            s.init({
              groups: this.value,
              ok: x => this.value = x
            })
          });
        }
      })
    }, settingsOrCaption);
  }
  selected(group: string) {
    if (!this.value)
      return false;
    return this.value.indexOf(group) >= 0;
  }

}
export function parseUrlInAddress(address: string) {
  let x = address.toLowerCase();
  let search = 'https://maps.google.com/maps?q=';
  if (x.startsWith(search)) {
    x = x.substring(search.length, 1000);
    let i = x.indexOf('&')
    if (i >= 0) {
      x = x.substring(0, i);
    }
    x = x.replace('%2c', ',');
    return x;
  } else if (x.startsWith('https://www.google.com/maps/place/')) {
    let r = x.split('!3d');
    if (r.length > 0) {
      x = r[r.length - 1];
      let j = x.split('!4d')
      x = j[0] + ',' + j[1];
      let i = x.indexOf('!');
      if (i > 0) {
        x = x.substring(0, i);
      }
      return leaveOnlyNumericChars(x);

    }
  } else if (x.indexOf('מיקום:') >= 0) {
    let j = x.substring(x.indexOf('מיקום:') + 6);
    let k = j.indexOf('דיוק');
    if (k > 0) {
      j = j.substring(0, k);
      j = leaveOnlyNumericChars(j);
      if (j.indexOf(',') > 0)
        return j;
    }


  }
  if (isGpsAddress(address)) {
    let x = address.split(',');
    return (+x[0]).toFixed(6) + ',' + (+x[1]).toFixed(6);
  }

  return address;
}





export function displayDupInfo(info: duplicateFamilyInfo, context: Context) {
  let r = [];


  if (info.tz) {
    r.push(getLang(context).identicalSocialSecurityNumber + ' ');
  }
  if (info.sameAddress) {
    r.push(getLang(context).sameAddress + " ");
  }
  if (info.phone1 || info.phone2 || info.phone3 || info.phone4) {
    r.push(getLang(context).identicalPhone);
  }
  if (info.nameDup) {
    r.push(getLang(context).similarName);
  }
  return info.address + ": " + r.join(', ');
}

export interface autocompleteResult {
  address: string,
  result: GeocodeResult
}

export function sendWhatsappToFamily(f: familyLikeEntity, context: Context, phone?: string) {
  if (!phone) {
    for (const p of [f.phone1, f.phone2, f.phone3, f.phone4]) {
      if (p.value && p.value.startsWith('05')) {
        phone = p.value;
        break;
      }
    }
  }
  PhoneColumn.sendWhatsappToPhone(phone,
    use.language.hello + ' ' + f.name.value + ',', context);
}
export function canSendWhatsapp(f: familyLikeEntity) {
  for (const p of [f.phone1, f.phone2, f.phone3, f.phone4]) {
    if (p.value && p.value.startsWith('05')) {
      return true;
    }
  }
}

export interface familyLikeEntity {
  name: StringColumn;
  phone1: StringColumn;
  phone2: StringColumn;
  phone3: StringColumn;
  phone4: StringColumn;
}