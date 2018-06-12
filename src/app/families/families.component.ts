import { Component, OnInit, ViewChild, Sanitizer } from '@angular/core';
import { GridSettings } from 'radweb';
import { Families, Helpers, CallStatus, BasketType, FamilySources } from '../models';
import { SelectService } from '../select-popup/select-service';
import { GeocodeInformation, GetGeoInformation } from '../shared/googleApiHelpers';

import { DomSanitizer } from '@angular/platform-browser';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-families',
  templateUrl: './families.component.html',
  styleUrls: ['./families.component.scss']
})
export class FamiliesComponent implements OnInit {

  saveToExcel() {


    let wb = XLSX.utils.book_new();
    let data = [];
    let title = [];
    let doneTitle = false;
    this.families.items.forEach(f => {
      let row = [];

      f.__iterateColumns().forEach(c => {
        if (!doneTitle) {
          title.push(c.caption);
        }
        let v = c.displayValue;
        if (v == undefined)
          v = '';
        v = v.toString();
        row.push(v);
      });
      if (!doneTitle) {
        data.push(title);
        doneTitle = true;
      }
      data.push(row);

    });
    let ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'test');
    XLSX.writeFile(wb, 'משפחות.xlsx');
    return;
  }

  families = new GridSettings(new Families(), {
    allowDelete: true,
    allowUpdate: true,
    allowInsert: true,
    get: { limit: 1000, orderBy: f => f.name },
    hideDataArea: true,
    columnSettings: families => [

      {
        column: families.name,
        width: '150'
      },

      {
        column: families.familyMembers,
        width: '50'
      },
      {
        column: families.language,
        dropDown: {
          items: families.language.getOptions()
        },
        width: '100'
      },
      {
        column: families.basketType,
        dropDown: { source: new BasketType() },
        width: '100'
      },
      {
        column: families.familySource,
        dropDown: { source: new FamilySources() },
        width: '100'
      },
    ],
    rowButtons: [
      {
        name: 'עדכני',
        click: f => this.gridView = !this.gridView
      }
    ]
  });
  familiesInfo = this.families.addArea({
    columnSettings: families => [
      families.name,
      families.familyMembers,
      {
        column: families.language,
        dropDown: {
          items: families.language.getOptions()
        }
      },
      {
        column: families.basketType,
        dropDown: { source: new BasketType() }
      },
      {
        column: families.familySource,
        dropDown: { source: new FamilySources() }
      },
      families.internalComment,
      families.deliveryComments,
      families.createDate,
      families.createUser




    ],
  });
  familiesAddress = this.families.addArea({
    columnSettings: families => [
      families.address,
      families.floor,
      families.appartment,
      families.addressComment,
    ]
  });
  phones = this.families.addArea({
    columnSettings: families => [
      families.phone1,
      families.phone1Description,
      families.phone2,
      families.phone2Description
    ]
  });
  callInfo = this.families.addArea({
    columnSettings: families => [
      {
        column: families.callStatus,
        dropDown: {
          items: families.callStatus.getOptions()
        }
      },
      families.callTime,
      families.callHelper,
      families.callComments,
    ]
  })
  deliverInfo = this.families.addArea({
    columnSettings: families => [
      {
        column: families.courier,
        getValue: f => f.courier.lookup(new Helpers()).name,
        hideDataOnInput: true,
        click: f => this.dialog.selectHelper(s => f.courier.value = s.id.value)

      },
      families.courierAssingTime,
      families.courierAssignUser,

      {
        column: families.deliverStatus,
        dropDown: {
          items: families.deliverStatus.getOptions()
        }
      },
      families.deliveryStatusDate,
      families.deliveryStatusUser,
      families.courierComments,
    ]
  });
  gridView = true;
  constructor(private dialog: SelectService, private san: DomSanitizer) { }


  ngOnInit() {

  }


  static route = 'families';
  static caption = 'משפחות';


}